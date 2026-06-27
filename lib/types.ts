/** Shared types for the Urban Radius algorithm, data layer, and worker protocol. */

/** A single population data point: an H3 hexagon centroid. */
export interface PopNode {
  lng: number;
  lat: number;
  population: number;
}

/** A detected city: a converged centre and its Urban Radius. */
export interface Cluster {
  id: string;
  center: { lng: number; lat: number };
  radiusKm: number;
  totalPopulation: number;
  memberNodeCount: number;
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

// --- Web Worker protocol (Section 9) ----------------------------------------

export interface WorkerInput {
  nodes: PopNode[];
  k: number;
  /** Convergence tolerance for centre movement, km (e.g. 0.05). */
  epsilon: number;
  /** Damping factor for mean-shift steps, 0 < alpha <= 1. */
  alpha: number;
}

export interface WorkerOutput {
  clusters: Cluster[];
  meta: {
    seedCount: number;
    executionTimeMs: number;
  };
}

/** Messages posted to the worker. */
export type WorkerRequest = {
  type: "run";
  requestId: number;
  payload: WorkerInput;
};

/** Messages posted back from the worker. */
export type WorkerResponse =
  | { type: "result"; requestId: number; payload: WorkerOutput }
  | { type: "error"; requestId: number; message: string };
