/** Shared types for the Urban Radius algorithm, data layer, and worker protocol. */

/** A single population data point: an H3 hexagon centroid. */
export interface PopNode {
  lng: number;
  lat: number;
  population: number;
}

/** Real-world city data matched from the gazetteer to this cluster. */
export interface MatchedCity {
  name: string;
  country: string;
  lat: number;
  lon: number;
  /** Real population from the gazetteer (cities50000.json). */
  pop: number;
  /** 1-indexed rank in the gazetteer sorted by population descending. */
  rank: number;
}

/** A detected city: a converged centre and its Urban Radius. */
export interface Cluster {
  id: string;
  center: { lng: number; lat: number };
  radiusKm: number;
  totalPopulation: number;
  memberNodeCount: number;
  /** Assumed city name (nearest large gazetteer city inside the disk), if any. */
  name?: string;
  /** Full gazetteer match data (position, real population, rank). */
  matchedCity?: MatchedCity;
}

/** A gazetteer entry from public/data/city_names (GeoNames-style). */
export interface NamedCity {
  name: string;
  country: string;
  lat: number;
  lon: number;
  pop: number;
}

/** A region entry in the data manifest (public/data/res_<id>/regions.json). */
export interface RegionInfo {
  slug: string;
  name: string;
  /** [lngMin, latMin, lngMax, latMax] */
  bbox: [number, number, number, number];
  /** Map fly-to centre [lng, lat]. */
  center: [number, number];
  zoom: number;
  nodeCount: number;
}

export interface RegionsManifest {
  resolutionId: string;
  regions: RegionInfo[];
}

/** GeoJSON shapes the app consumes (Section 5.3 of the spec). */
export interface PopFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { population: number; h3Index: string };
}

export interface PopFeatureCollection {
  type: "FeatureCollection";
  features: PopFeature[];
}

// --- Algorithm I/O (Section 9) ----------------------------------------------
// Named Worker* for continuity with the spec; the algorithm now runs server-side
// (see lib/serverData.ts) and these are the API request/response payload shapes.

export interface WorkerInput {
  nodes: PopNode[];
  k: number;
  /** Convergence tolerance for centre movement, km (e.g. 0.05). */
  epsilon: number;
  /** Damping factor for mean-shift steps, 0 < alpha <= 1. */
  alpha: number;
  /**
   * Discard detected cities whose Urban Radius is below this (km). Filters out
   * sub-resolution, degenerate clusters (e.g. a 0.3 km "city"). Optional;
   * defaults to a small floor in the algorithm.
   */
  minRadiusKm?: number;
  /**
   * Multiplier in the merge criterion: merge if dist < (Ri + Rj) * overlapFactor.
   * 0.5 = requires 50% overlap (more aggressive merging),
   * 1.0 = merge only when disks just touch (less aggressive).
   * Defaults to 0.5.
   */
  overlapFactor?: number;
}

export interface WorkerOutput {
  clusters: Cluster[];
  meta: {
    seedCount: number;
    executionTimeMs: number;
  };
}

/** SSE event types streamed from /api/clusters */
export type ClusterSSEEvent =
  | { type: "progress"; pass: number; clusters: Cluster[] }
  | { type: "done"; clusters: Cluster[]; meta: WorkerOutput["meta"] }
  | { type: "error"; message: string };
