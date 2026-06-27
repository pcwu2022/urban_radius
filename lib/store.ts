/**
 * Application state (zustand). Owns:
 *   - the regions manifest + currently selected region's nodes,
 *   - the committed tuning constant k,
 *   - the algorithm Web Worker lifecycle and its latest results.
 *
 * Everything runs client-side (data is fetched as static GeoJSON, computation runs
 * in the worker), so the app can be statically exported for GitHub Pages.
 */

import { create } from "zustand";
import {
  regionGeojsonUrl,
  regionsManifestUrl,
} from "./dataConfig";
import type {
  Cluster,
  PopFeatureCollection,
  PopNode,
  RegionInfo,
  RegionsManifest,
  WorkerOutput,
  WorkerRequest,
  WorkerResponse,
} from "./types";

export const DEFAULT_K = 30;
export const K_MIN = 2;
export const K_MAX = 200;
export const EPSILON_KM = 0.05;
export const ALPHA = 1;

type DataStatus = "idle" | "loading" | "ready" | "error";
type ComputeStatus = "idle" | "computing" | "done" | "error";

interface AppState {
  manifest: RegionsManifest | null;
  regionSlug: string | null;
  nodes: PopNode[];
  dataStatus: DataStatus;
  dataError?: string;

  k: number;

  clusters: Cluster[];
  meta: WorkerOutput["meta"] | null;
  computeStatus: ComputeStatus;
  computeError?: string;

  init: () => Promise<void>;
  selectRegion: (slug: string) => Promise<void>;
  setK: (k: number) => void;
  recompute: () => void;
  activeRegion: () => RegionInfo | null;
}

// --- Worker singleton (created lazily, browser only) ------------------------

let worker: Worker | null = null;
let requestSeq = 0;
let latestRequestId = 0;

function getWorker(): Worker | null {
  if (typeof window === "undefined") return null;
  if (!worker) {
    worker = new Worker(new URL("./algorithm.worker.ts", import.meta.url));
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      // ignore stale results from superseded requests
      if (msg.requestId !== latestRequestId) return;
      if (msg.type === "result") {
        useStore.setState({
          clusters: msg.payload.clusters,
          meta: msg.payload.meta,
          computeStatus: "done",
          computeError: undefined,
        });
      } else if (msg.type === "error") {
        useStore.setState({
          computeStatus: "error",
          computeError: msg.message,
        });
      }
    };
  }
  return worker;
}

function dispatchCompute(nodes: PopNode[], k: number): void {
  const w = getWorker();
  if (!w || nodes.length === 0) return;
  requestSeq += 1;
  latestRequestId = requestSeq;
  const req: WorkerRequest = {
    type: "run",
    requestId: requestSeq,
    payload: { nodes, k, epsilon: EPSILON_KM, alpha: ALPHA },
  };
  useStore.setState({ computeStatus: "computing" });
  w.postMessage(req);
}

// --- Store ------------------------------------------------------------------

export const useStore = create<AppState>((set, get) => ({
  manifest: null,
  regionSlug: null,
  nodes: [],
  dataStatus: "idle",

  k: DEFAULT_K,

  clusters: [],
  meta: null,
  computeStatus: "idle",

  activeRegion: () => {
    const { manifest, regionSlug } = get();
    if (!manifest || !regionSlug) return null;
    return manifest.regions.find((r) => r.slug === regionSlug) ?? null;
  },

  init: async () => {
    if (get().manifest) return;
    try {
      const res = await fetch(regionsManifestUrl());
      if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
      const manifest: RegionsManifest = await res.json();
      set({ manifest });
      // default to the most populous region by node count for a good first view
      const first =
        [...manifest.regions].sort((a, b) => b.nodeCount - a.nodeCount)[0] ??
        manifest.regions[0];
      if (first) await get().selectRegion(first.slug);
    } catch (err) {
      set({
        dataStatus: "error",
        dataError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  selectRegion: async (slug: string) => {
    if (get().regionSlug === slug && get().dataStatus === "ready") return;
    set({
      regionSlug: slug,
      dataStatus: "loading",
      dataError: undefined,
      clusters: [],
      meta: null,
      computeStatus: "idle",
    });
    try {
      const res = await fetch(regionGeojsonUrl(slug));
      if (!res.ok) throw new Error(`region HTTP ${res.status}`);
      const fc: PopFeatureCollection = await res.json();
      const nodes: PopNode[] = fc.features.map((f) => ({
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        population: f.properties.population,
      }));
      // guard against a stale region switch resolving out of order
      if (get().regionSlug !== slug) return;
      set({ nodes, dataStatus: "ready" });
      dispatchCompute(nodes, get().k);
    } catch (err) {
      if (get().regionSlug !== slug) return;
      set({
        dataStatus: "error",
        dataError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setK: (k: number) => {
    const clamped = Math.max(K_MIN, Math.min(K_MAX, k));
    set({ k: clamped });
    const { nodes, dataStatus } = get();
    if (dataStatus === "ready") dispatchCompute(nodes, clamped);
  },

  recompute: () => {
    const { nodes, k, dataStatus } = get();
    if (dataStatus === "ready") dispatchCompute(nodes, k);
  },
}));
