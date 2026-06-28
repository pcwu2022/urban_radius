/**
 * The Urban Radius (R) algorithm — full implementation (spec.md Section 1).
 *
 * Pure TypeScript with no DOM/Next dependencies, so it runs identically in a Web
 * Worker or in tests. A uniform spatial grid keeps every R(c) evaluation roughly
 * O(nodes within R) instead of O(N), which matters for the larger regions.
 *
 * Pipeline (runAlgorithm):
 *   1. seed at every local maximum of population density        (Section 1.4)
 *   2. adaptive mean-shift from each seed -> (center, R)         (Section 1.3)
 *   3. merge overlapping clusters transitively until stable      (Section 1.5)
 */

import type { Cluster, PopNode, WorkerInput, WorkerOutput } from "./types";

const EARTH_R_KM = 6371.0088;
const EPS_KM = 1e-6; // guard against divide-by-zero at r -> 0
const MAX_MEANSHIFT_ITERS = 200;

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Great-circle distance in km. */
export function haversineKm(
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number
): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------
// Spatial grid index (uniform lng/lat cells)
// ---------------------------------------------------------------------------

class SpatialGrid {
  readonly nodes: PopNode[];
  private cellDeg: number;
  private cells: Map<string, number[]> = new Map();
  /** Characteristic node spacing (median nearest-neighbour distance), km. */
  readonly spacingKm: number;
  /** Diagonal of the data bounding box, km — an upper bound on any useful radius. */
  readonly extentKm: number;

  constructor(nodes: PopNode[]) {
    this.nodes = nodes;
    // Estimate spacing from a sample, used to size grid cells and seed neighbourhoods.
    this.spacingKm = estimateSpacingKm(nodes);
    // Cell ~ one node-spacing wide keeps a few nodes per cell.
    this.cellDeg = clamp(this.spacingKm / 111, 0.05, 1.0);

    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const key = this.key(n.lng, n.lat);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(i);
      else this.cells.set(key, [i]);
      if (n.lng < minLng) minLng = n.lng;
      if (n.lat < minLat) minLat = n.lat;
      if (n.lng > maxLng) maxLng = n.lng;
      if (n.lat > maxLat) maxLat = n.lat;
    }
    this.extentKm = nodes.length
      ? haversineKm(minLng, minLat, maxLng, maxLat)
      : 0;
  }

  private key(lng: number, lat: number): string {
    const cx = Math.floor(lng / this.cellDeg);
    const cy = Math.floor(lat / this.cellDeg);
    return `${cx},${cy}`;
  }

  /**
   * Return indices of nodes within `radiusKm` of (lng, lat), each with its
   * precomputed distance. Iterates only the covering cell block, then filters.
   */
  within(lng: number, lat: number, radiusKm: number): { idx: number; dist: number }[] {
    const latSpanDeg = radiusKm / 111;
    const cosLat = Math.max(0.01, Math.cos(toRad(lat)));
    const lngSpanDeg = radiusKm / (111 * cosLat);
    const cx0 = Math.floor((lng - lngSpanDeg) / this.cellDeg);
    const cx1 = Math.floor((lng + lngSpanDeg) / this.cellDeg);
    const cy0 = Math.floor((lat - latSpanDeg) / this.cellDeg);
    const cy1 = Math.floor((lat + latSpanDeg) / this.cellDeg);

    const out: { idx: number; dist: number }[] = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const bucket = this.cells.get(`${cx},${cy}`);
        if (!bucket) continue;
        for (const idx of bucket) {
          const n = this.nodes[idx];
          const d = haversineKm(lng, lat, n.lng, n.lat);
          if (d <= radiusKm) out.push({ idx, dist: d });
        }
      }
    }
    return out;
  }

  /** Neighbour node indices within `radiusKm` (excluding the node itself). */
  neighbors(selfIdx: number, radiusKm: number): number[] {
    const n = this.nodes[selfIdx];
    return this.within(n.lng, n.lat, radiusKm)
      .filter((c) => c.idx !== selfIdx)
      .map((c) => c.idx);
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Median nearest-neighbour distance over a sample of nodes (km). */
function estimateSpacingKm(nodes: PopNode[]): number {
  if (nodes.length < 2) return 25;
  
  // A sample size of 200–500 is plenty for an accurate median calibration
  const sampleSize = Math.min(200, nodes.length);
  const step = Math.max(1, Math.floor(nodes.length / sampleSize));
  const nn: number[] = [];
  
  // Outer loop: Sample a sparse set of nodes to test
  for (let i = 0; i < nodes.length; i += step) {
    const a = nodes[i];
    let best = Infinity;
    
    // Inner loop: MUST check against ALL nodes (j++) to find the TRUE closest neighbor
    for (let j = 0; j < nodes.length; j++) { 
      if (i === j) continue;
      const b = nodes[j];
      
      const d = haversineKm(a.lng, a.lat, b.lng, b.lat);
      if (d < best) {
        best = d;
      }
    }
    if (isFinite(best)) nn.push(best);
  }
  
  if (!nn.length) return 25;
  nn.sort((x, y) => x - y);
  return nn[Math.floor(nn.length / 2)] || 25;
}

// ---------------------------------------------------------------------------
// R(c) — the core definition (Section 1.2)
// ---------------------------------------------------------------------------

interface RResult {
  radiusKm: number;
  memberIdx: number[];
  totalPopulation: number;
}

/**
 * R(c) = the largest r such that ρ(r', c) > k·r' for every r' up to r.
 *
 * Walk nodes outward by distance, accumulating population. ρ(r) = pop/(π r²) is
 * non-increasing while k·r increases, so the difference crosses zero at most once.
 * R is the analytic crossing radius derived from the cumulative population of the
 * last node that still satisfied the threshold: r* = cbrt(P / (π k)).
 */
function computeR(grid: SpatialGrid, lng: number, lat: number, k: number): RResult {
  if (k <= 0 || grid.nodes.length === 0) {
    return { radiusKm: 0, memberIdx: [], totalPopulation: 0 };
  }
  const PI = Math.PI;
  // Progressive gather: start near the characteristic spacing and double until the
  // threshold crossing is captured inside the gathered set (or all nodes are in).
  let searchKm = Math.max(4 * grid.spacingKm, 32);
  const maxSearchKm = grid.extentKm + grid.spacingKm + 1;

  for (;;) {
    const cand = grid.within(lng, lat, searchKm);
    cand.sort((a, b) => a.dist - b.dist);

    let cum = 0;
    let lastGoodPop = 0;
    let lastGoodCount = 0;
    let crossed = false;

    for (let i = 0; i < cand.length; i++) {
      const node = grid.nodes[cand[i].idx];
      cum += node.population;
      const d = Math.max(cand[i].dist, EPS_KM);
      const rho = cum / (PI * d * d); // people / km²
      if (rho > k * d) {
        lastGoodPop = cum;
        lastGoodCount = i + 1;
      } else {
        crossed = true;
        break;
      }
    }

    const coveredAll = cand.length === grid.nodes.length;
    if (crossed || searchKm >= maxSearchKm || coveredAll) {
      if (lastGoodCount === 0) {
        return { radiusKm: 0, memberIdx: [], totalPopulation: 0 };
      }
      // r* where P/(π r²) = k r  ->  r = (P / (π k))^(1/3)
      const radiusKm = Math.cbrt(lastGoodPop / (PI * k));
      const memberIdx = cand.slice(0, lastGoodCount).map((c) => c.idx);
      return { radiusKm, memberIdx, totalPopulation: lastGoodPop };
    }
    searchKm *= 2;
  }
}

// ---------------------------------------------------------------------------
// Adaptive mean-shift (Section 1.3)
// ---------------------------------------------------------------------------

interface ShiftResult {
  center: { lng: number; lat: number };
  radiusKm: number;
  memberIdx: number[];
  totalPopulation: number;
}

function meanShift(
  grid: SpatialGrid,
  startLng: number,
  startLat: number,
  k: number,
  epsilon: number,
  alpha: number
): ShiftResult | null {
  let lng = startLng;
  let lat = startLat;
  let last: RResult = { radiusKm: 0, memberIdx: [], totalPopulation: 0 };

  for (let iter = 0; iter < MAX_MEANSHIFT_ITERS; iter++) {
    const r = computeR(grid, lng, lat, k);
    last = r;
    if (r.memberIdx.length === 0 || r.radiusKm <= 0) return null; // seed died

    // population-weighted centroid of members
    let sw = 0,
      sLng = 0,
      sLat = 0;
    for (const idx of r.memberIdx) {
      const n = grid.nodes[idx];
      sw += n.population;
      sLng += n.lng * n.population;
      sLat += n.lat * n.population;
    }
    if (sw <= 0) return null;
    const targetLng = sLng / sw;
    const targetLat = sLat / sw;

    // damped step toward the centroid
    const newLng = lng + alpha * (targetLng - lng);
    const newLat = lat + alpha * (targetLat - lat);
    const moved = haversineKm(lng, lat, newLng, newLat);
    lng = newLng;
    lat = newLat;
    if (moved < epsilon) break; // converged
  }

  return {
    center: { lng, lat },
    radiusKm: last.radiusKm,
    memberIdx: last.memberIdx,
    totalPopulation: last.totalPopulation,
  };
}

function findSeeds(grid: SpatialGrid): number[] {
  const nodes = grid.nodes;

  // -------------------------------------------------------------------------
  // SCALING COEFFICIENT: Adjust this to change seeding density.
  // 0.1 scales a 296km spacing down to ~29.6km per cell.
  // A smaller coefficient = smaller cells = more seeds (closer cities caught).
  // -------------------------------------------------------------------------
  const RESOLUTION_COEFFICIENT = 1.0; 
  
  // Compute the scaled cell size in kilometers, then convert to degrees
  const scaledSpacingKm = grid.spacingKm * RESOLUTION_COEFFICIENT;
  const cellDeg = Math.max(scaledSpacingKm / 111, 1e-4);

  type Best = { pop: number; idx: number };
  const cellBest = new Map<string, Best>();

  // Pass 1: Find the local champion inside each scaled grid cell
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.population <= 0) continue;

    const key = `${Math.floor(n.lng / cellDeg)},${Math.floor(n.lat / cellDeg)}`;
    const b = cellBest.get(key);
    if (!b || n.population > b.pop || (n.population === b.pop && i < b.idx)) {
      cellBest.set(key, { pop: n.population, idx: i });
    }
  }

  // Pass 2: A node is a seed if it beats all champions in its 3×3 cell block
  const seeds: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.population <= 0) continue;

    const cx = Math.floor(n.lng / cellDeg);
    const cy = Math.floor(n.lat / cellDeg);
    let bestPop = n.population;
    let bestIdx = i;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const b = cellBest.get(`${cx + dx},${cy + dy}`);
        if (!b) continue;
        if (b.pop > bestPop || (b.pop === bestPop && b.idx < bestIdx)) {
          bestPop = b.pop;
          bestIdx = b.idx;
        }
      }
    }
    if (bestIdx === i) seeds.push(i);
  }
  return seeds;
}

// ---------------------------------------------------------------------------
// Merging overlapping clusters (Section 1.5) — union-find connected components
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[x] !== root) {
      const next = this.parent[x];
      this.parent[x] = root;
      x = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a),
      rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

interface WorkingCluster {
  center: { lng: number; lat: number };
  radiusKm: number;
  memberIdx: number[];
  totalPopulation: number;
}

/** One merge pass: returns the merged clusters and whether any merge happened. */
function mergePass(
  grid: SpatialGrid,
  clusters: WorkingCluster[],
  k: number,
  epsilon: number,
  alpha: number
): { clusters: WorkingCluster[]; merged: boolean } {
  const n = clusters.length;
  const uf = new UnionFind(n);
  let anyEdge = false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ci = clusters[i],
        cj = clusters[j];
      const d = haversineKm(
        ci.center.lng,
        ci.center.lat,
        cj.center.lng,
        cj.center.lat
      );
      // merge iff the R-disks overlap at all (symmetric)
      if (d < (ci.radiusKm + cj.radiusKm)*0.5) {
        uf.union(i, j);
        anyEdge = true;
      }
    }
  }
  if (!anyEdge) return { clusters, merged: false };

  // group indices by connected component
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }

  const next: WorkingCluster[] = [];
  for (const members of groups.values()) {
    if (members.length === 1) {
      next.push(clusters[members[0]]);
      continue;
    }
    // recompute: re-run mean-shift from the population-weighted centroid of the
    // member clusters' centres (Section 1.5 step 3).
    let sw = 0,
      sLng = 0,
      sLat = 0;
    for (const m of members) {
      const c = clusters[m];
      const w = c.totalPopulation || 1;
      sw += w;
      sLng += c.center.lng * w;
      sLat += c.center.lat * w;
    }
    const startLng = sLng / sw;
    const startLat = sLat / sw;
    const shifted = meanShift(grid, startLng, startLat, k, epsilon, alpha);
    if (shifted && shifted.radiusKm > 0 && shifted.memberIdx.length > 0) {
      next.push(shifted);
    }
  }
  return { clusters: next, merged: true };
}

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

export function runAlgorithm(input: WorkerInput): WorkerOutput {
  const start = nowMs();
  const { nodes, k } = input;
  const epsilon = input.epsilon > 0 ? input.epsilon : 0.05;
  const alpha = input.alpha > 0 && input.alpha <= 1 ? input.alpha : 1;
  const minRadiusKm = input.minRadiusKm && input.minRadiusKm > 0 ? input.minRadiusKm : 0.5;

  const grid = new SpatialGrid(nodes);

  // 1. seeds
  const seeds = findSeeds(grid);
  console.log(`runAlgorithm: ${nodes.length} nodes, ${seeds.length} seeds, spacing ${grid.spacingKm.toFixed(2)} km`);

  // 2. mean-shift from every seed
  const raw: WorkingCluster[] = [];
  for (const s of seeds) {
    const n = grid.nodes[s];
    const shifted = meanShift(grid, n.lng, n.lat, k, epsilon, alpha);
    if (shifted && shifted.radiusKm > 0 && shifted.memberIdx.length > 0) {
      raw.push(shifted);
    }
  }
  console.log(`runAlgorithm: ${raw.length} clusters after mean-shift, ${Math.round(nowMs() - start)} ms`);

  // Pre-dedup near-identical centres (they would merge anyway) to speed up the
  // O(M²) merge passes. Bucket centres onto a fine grid keyed by epsilon.
  const deduped = dedupeClusters(raw, epsilon);
  // const deduped = raw;
  console.log(`runAlgorithm: ${deduped.length} clusters after dedupe, ${Math.round(nowMs() - start)} ms`);


  // Discard clusters with only one member node (they are degenerate and will merge anyway)
  const filtered = deduped.filter((c) => c.memberIdx.length > 1);
  console.log(`runAlgorithm: ${filtered.length} clusters after filtering singletons, ${Math.round(nowMs() - start)} ms`);
  
  // 3. merge until a full pass produces zero merges
  let clusters = filtered;
  for (let pass = 0; pass < clusters.length + 1; pass++) {
    const res = mergePass(grid, clusters, k, epsilon, alpha);
    clusters = res.clusters;
    console.log(`runAlgorithm: ${clusters.length} clusters after merge pass ${pass + 1}, ${Math.round(nowMs() - start)} ms`);
    if (!res.merged) break;
  }
  console.log(`runAlgorithm: ${clusters.length} clusters after merge, ${Math.round(nowMs() - start)} ms`);

  // finalize: drop empties and sub-resolution cities, sort by population desc
  const out: Cluster[] = clusters
    .filter(
      (c) =>
        c.radiusKm >= minRadiusKm &&
        c.memberIdx.length > 0 &&
        c.totalPopulation > 0
    )
    .sort((a, b) => b.totalPopulation - a.totalPopulation)
    .map((c, i) => ({
      id: `city-${i}`,
      center: { lng: c.center.lng, lat: c.center.lat },
      radiusKm: c.radiusKm,
      totalPopulation: Math.round(c.totalPopulation),
      memberNodeCount: c.memberIdx.length,
    }));

  console.log(`runAlgorithm: ${out.length} clusters after merge, ${Math.round(nowMs() - start)} ms`);

  return {
    clusters: out,
    meta: { seedCount: seeds.length, executionTimeMs: Math.round(nowMs() - start) },
  };
}

/** Collapse clusters whose centres fall within `epsilon` km of each other. */
function dedupeClusters(
  clusters: WorkingCluster[],
  epsilon: number
): WorkingCluster[] {
  const cellDeg = Math.max(epsilon / 111, 1e-4);
  const seen = new Map<string, WorkingCluster>();
  for (const c of clusters) {
    const cx = Math.round(c.center.lng / cellDeg);
    const cy = Math.round(c.center.lat / cellDeg);
    const key = `${cx},${cy}`;
    const existing = seen.get(key);
    // keep the larger-radius representative on collision
    if (!existing || c.radiusKm > existing.radiusKm) seen.set(key, c);
  }
  return [...seen.values()];
}

/** performance.now() when available (worker/browser), else 0-based fallback. */
function nowMs(): number {
  if (typeof performance !== "undefined" && performance.now) {
    return performance.now();
  }
  return 0;
}
