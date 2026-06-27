import "server-only";

/**
 * Server-side data + algorithm layer.
 *
 * The high-resolution Kontur grids (e.g. ~0.5M nodes per continent at 3 km) are far
 * too large to ship to the browser and cluster client-side, so both the data
 * processing and the Urban Radius algorithm run here, on the server:
 *
 *   - region GeoJSON is read from disk and parsed once, then cached in memory;
 *   - /api/clusters runs runAlgorithm() on the FULL node set and caches results per
 *     (region, k);
 *   - /api/population returns only a bounded, downsampled set for the dots layer.
 *
 * Nothing in here is bundled for the client (guarded by "server-only").
 */

import fs from "fs";
import path from "path";

import { haversineKm, runAlgorithm } from "./algorithm";
import { ACTIVE_CONFIG } from "./dataConfig";
import type {
  Cluster,
  NamedCity,
  PopFeatureCollection,
  PopNode,
  WorkerOutput,
} from "./types";

const EPSILON_KM = 0.05;
const ALPHA = 1;
// Discard cities below 10% of one hexagon edge, but never below a 1 km hard floor.
const MIN_RADIUS_KM = Math.max(1, ACTIVE_CONFIG.averageEdgeLengthKm * 0.1);

// Gazetteer used to label detected clusters with assumed city names.
const CITY_NAMES_FILE = "data/city_names/cities50000.json";

// Max points returned to the client for the population dots layer. The full node
// set is used for the algorithm; for display we keep the densest points so cities
// stay visible while the payload stays bounded.
const DISPLAY_CAP = 50000;

// region slugs are used to build a file path — restrict to a safe charset.
const SLUG_RE = /^[a-z0-9-]+$/;

const nodeCache = new Map<string, PopNode[]>();
const clusterCache = new Map<string, WorkerOutput>();
let cityNames: NamedCity[] | null = null;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** Load + parse a region's full node set (cached in memory). */
export function loadRegionNodes(slug: string): PopNode[] {
  const cached = nodeCache.get(slug);
  if (cached) return cached;

  const file = path.join(
    process.cwd(),
    "public",
    ACTIVE_CONFIG.dataPath,
    `${slug}.geojson`
  );
  const raw = fs.readFileSync(file, "utf8");
  const fc: PopFeatureCollection = JSON.parse(raw);
  const nodes: PopNode[] = fc.features.map((f) => ({
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    population: f.properties.population,
  }));
  nodeCache.set(slug, nodes);
  return nodes;
}

/** Bounded set of points for the display layer (densest first). */
export function regionDisplayNodes(slug: string): {
  nodes: PopNode[];
  totalNodeCount: number;
} {
  const all = loadRegionNodes(slug);
  if (all.length <= DISPLAY_CAP) return { nodes: all, totalNodeCount: all.length };
  const densest = [...all]
    .sort((a, b) => b.population - a.population)
    .slice(0, DISPLAY_CAP);
  return { nodes: densest, totalNodeCount: all.length };
}

/** Load + cache the gazetteer, sorted by population descending. */
function loadCityNames(): NamedCity[] {
  if (cityNames) return cityNames;
  const file = path.join(process.cwd(), "public", CITY_NAMES_FILE);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Array<{
    name: string;
    country: string;
    lat: string | number;
    lon: string | number;
    pop: number;
  }>;
  cityNames = raw
    .map((c) => ({
      name: c.name,
      country: c.country,
      lat: Number(c.lat),
      lon: Number(c.lon),
      pop: c.pop,
    }))
    .sort((a, b) => b.pop - a.pop);
  return cityNames;
}

/**
 * Assign assumed names to clusters (spec.md Section 10), in place.
 *
 * Walk the gazetteer from the most populous city downward. Each cluster's R-disks
 * are disjoint (the merge step guarantees no overlap), so a city falls inside at
 * most one disk. When a city falls inside an as-yet-unnamed cluster, that cluster
 * takes the city's name and is marked named; a city inside an already-named cluster
 * is skipped. Thus every cluster is named after the largest city it contains. Stop
 * once every cluster is named or the list is exhausted.
 */
function nameClusters(clusters: Cluster[]): void {
  if (clusters.length === 0) return;
  const cities = loadCityNames();
  let remaining = clusters.length;

  for (const city of cities) {
    if (remaining === 0) break; // all clusters named
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      if (c.name !== undefined) continue; // already named
      if (haversineKm(city.lon, city.lat, c.center.lng, c.center.lat) <= c.radiusKm) {
        c.name = city.name;
        remaining--;
        break; // a city names at most one cluster
      }
    }
  }
}

/** Run (or reuse a cached) clustering for a region at a given k. */
export function computeClusters(slug: string, k: number): WorkerOutput {
  const key = `${slug}:${k.toPrecision(5)}`;
  const cached = clusterCache.get(key);
  if (cached) return cached;

  const nodes = loadRegionNodes(slug);
  const out = runAlgorithm({
    nodes,
    k,
    epsilon: EPSILON_KM,
    alpha: ALPHA,
    minRadiusKm: MIN_RADIUS_KM,
  });
  nameClusters(out.clusters);
  clusterCache.set(key, out);
  return out;
}
