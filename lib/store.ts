/**
 * Application state (zustand). Owns:
 *   - the regions manifest + currently selected region's display nodes,
 *   - the committed tuning constant k,
 *   - the latest clustering results.
 *
 * Data processing and the Urban Radius algorithm run SERVER-SIDE (the grids are too
 * large to ship to the browser). The client fetches:
 *   - GET /api/population?region=…        → bounded, downsampled points for the map
 *   - GET /api/clusters?region=…&k=…       → detected cities (algorithm output)
 * The regions manifest is a small static file under /data.
 */

import { create } from "zustand";

import { ACTIVE_CONFIG, assetUrl, regionsManifestUrl } from "./dataConfig";
import type {
  Cluster,
  PopNode,
  RegionInfo,
  RegionsManifest,
  WorkerOutput,
} from "./types";

// k spans several orders of magnitude in effect, so the UI slider is logarithmic
// over this range (see Sidebar).
export const K_MIN = 1;
export const K_MAX = 1000;
export const DEFAULT_K = 100;

// Surfaced for display; the actual radius floor is applied server-side.
export const MIN_RADIUS_KM = Math.max(1, ACTIVE_CONFIG.averageEdgeLengthKm * 0.1);

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

function apiUrl(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${assetUrl(path)}?${qs}`;
}

/** Reflect the current region + k into the location query (shareable / reloadable). */
function syncUrl(): void {
  if (typeof window === "undefined") return;
  const { regionSlug, k } = useStore.getState();
  if (!regionSlug) return;
  const sp = new URLSearchParams(window.location.search);
  sp.set("region", regionSlug);
  sp.set("k", String(k));
  window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
}

// --- Latest-wins request tracking for the clusters endpoint -----------------
// Rapid slider changes fire overlapping requests; only the newest one should win.
let computeSeq = 0;
let inflight: AbortController | null = null;

function dispatchCompute(slug: string, k: number): void {
  const requestId = ++computeSeq;
  inflight?.abort();
  const controller = new AbortController();
  inflight = controller;
  useStore.setState({ computeStatus: "computing", computeError: undefined });
  syncUrl();

  fetch(apiUrl("/api/clusters", { region: slug, k: String(k) }), {
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`clusters HTTP ${res.status}`);
      return (await res.json()) as WorkerOutput;
    })
    .then((out) => {
      if (requestId !== computeSeq) return; // superseded
      useStore.setState({
        clusters: out.clusters,
        meta: out.meta,
        computeStatus: "done",
        computeError: undefined,
      });
    })
    .catch((err: unknown) => {
      if (controller.signal.aborted || requestId !== computeSeq) return;
      useStore.setState({
        computeStatus: "error",
        computeError: err instanceof Error ? err.message : String(err),
      });
    });
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

    // Seed region + k from the URL query (?region=…&k=…) if present.
    let urlRegion: string | null = null;
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      urlRegion = sp.get("region");
      const urlK = Number(sp.get("k"));
      if (Number.isFinite(urlK) && urlK > 0) {
        set({ k: Math.max(K_MIN, Math.min(K_MAX, urlK)) });
      }
    }

    try {
      const res = await fetch(regionsManifestUrl());
      if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
      const manifest: RegionsManifest = await res.json();
      set({ manifest });
      // honour ?region= if valid, else default to the most populous region
      const fromUrl = urlRegion
        ? manifest.regions.find((r) => r.slug === urlRegion)
        : undefined;
      const target =
        fromUrl ??
        [...manifest.regions].sort((a, b) => b.nodeCount - a.nodeCount)[0] ??
        manifest.regions[0];
      if (target) await get().selectRegion(target.slug);
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
      const res = await fetch(apiUrl("/api/population", { region: slug }));
      if (!res.ok) throw new Error(`population HTTP ${res.status}`);
      const data = (await res.json()) as { nodes: PopNode[] };
      // guard against a stale region switch resolving out of order
      if (get().regionSlug !== slug) return;
      set({ nodes: data.nodes, dataStatus: "ready" });
      dispatchCompute(slug, get().k);
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
    const { regionSlug, dataStatus } = get();
    if (regionSlug && dataStatus === "ready") dispatchCompute(regionSlug, clamped);
  },

  recompute: () => {
    const { regionSlug, k, dataStatus } = get();
    if (regionSlug && dataStatus === "ready") dispatchCompute(regionSlug, k);
  },
}));
