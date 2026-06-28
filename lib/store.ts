/**
 * Application state (zustand). Owns:
 *   - the regions manifest + currently selected region's display nodes,
 *   - the committed tuning constants (k, overlapFactor, minRadiusMult),
 *   - the latest clustering results, streamed live via SSE.
 *
 * Data processing and the Urban Radius algorithm run SERVER-SIDE (the grids are too
 * large to ship to the browser). The client fetches:
 *   - GET /api/population?region=…        → bounded, downsampled points for the map
 *   - GET /api/clusters?region=…&k=…       → SSE stream of detected cities
 * The regions manifest is a small static file under /data.
 */

import { create } from "zustand";

import { ACTIVE_CONFIG, assetUrl, regionsManifestUrl } from "./dataConfig";
import type {
  Cluster,
  ClusterSSEEvent,
  PopNode,
  RegionInfo,
  RegionsManifest,
  WorkerOutput,
} from "./types";

// k spans several orders of magnitude in effect, so the UI slider is logarithmic
// over this range (see Sidebar).
export const K_MIN = 50;
export const K_MAX = 5000;
export const DEFAULT_K = 100;

// Surfaced for display; the actual radius floor is applied server-side.
export const MIN_RADIUS_KM = Math.max(1, ACTIVE_CONFIG.averageEdgeLengthKm * 0.1);

export const OVERLAP_FACTOR_MIN = 0.5;
export const OVERLAP_FACTOR_MAX = 1.0;
export const OVERLAP_FACTOR_DEFAULT = 0.5;

export const MIN_RADIUS_MULT_MIN = 0.1;
export const MIN_RADIUS_MULT_MAX = 5.0;
export const MIN_RADIUS_MULT_DEFAULT = 1.0;

type DataStatus = "idle" | "loading" | "ready" | "error";
type ComputeStatus = "idle" | "computing" | "done" | "error";

interface AppState {
  manifest: RegionsManifest | null;
  regionSlug: string | null;
  nodes: PopNode[];
  dataStatus: DataStatus;
  dataError?: string;

  k: number;
  overlapFactor: number;
  minRadiusMult: number;

  clusters: Cluster[];
  meta: WorkerOutput["meta"] | null;
  computeStatus: ComputeStatus;
  computeError?: string;

  /** Whether to show the real (gazetteer) city positions layer on the map. */
  showRealCities: boolean;
  selectedClusterId: string | null;

  init: () => Promise<void>;
  selectRegion: (slug: string) => Promise<void>;
  setK: (k: number) => void;
  setOverlapFactor: (v: number) => void;
  setMinRadiusMult: (v: number) => void;
  recompute: () => void;
  activeRegion: () => RegionInfo | null;
  toggleRealCities: () => void;
  setSelectedClusterId: (id: string | null) => void;
}

function apiUrl(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${assetUrl(path)}?${qs}`;
}

/** Reflect the current region + tuning params into the location query (shareable / reloadable). */
function syncUrl(): void {
  if (typeof window === "undefined") return;
  const { regionSlug, k, overlapFactor, minRadiusMult } = useStore.getState();
  if (!regionSlug) return;
  const sp = new URLSearchParams(window.location.search);
  sp.set("region", regionSlug);
  sp.set("k", String(k));
  sp.set("overlapFactor", String(overlapFactor));
  sp.set("minRadiusMult", String(minRadiusMult));
  window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
}

// --- Latest-wins request tracking for the clusters SSE stream ---------------
// Rapid slider changes fire overlapping requests; only the newest one should win.
let computeSeq = 0;
let inflightController: AbortController | null = null;

function dispatchCompute(slug: string, k: number, overlapFactor: number, minRadiusMult: number): void {
  const requestId = ++computeSeq;

  // Cancel any previous SSE stream
  inflightController?.abort();
  const controller = new AbortController();
  inflightController = controller;

  useStore.setState({ computeStatus: "computing", computeError: undefined });
  syncUrl();

  const url = apiUrl("/api/clusters", {
    region: slug,
    k: String(k),
    overlapFactor: String(overlapFactor),
    minRadiusMult: String(minRadiusMult),
  });

  // Use fetch + ReadableStream to consume SSE — works with AbortController unlike EventSource.
  fetch(url, { signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`clusters HTTP ${res.status}`);
      if (!res.body) throw new Error("no response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE lines are separated by "\n\n"
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? ""; // keep incomplete last chunk

        for (const part of parts) {
          const line = part.trim();
          if (!line || line.startsWith(":")) continue; // keep-alive or comment
          const dataLine = line.startsWith("data: ") ? line.slice(6) : line;
          if (!dataLine) continue;

          let event: ClusterSSEEvent;
          try {
            event = JSON.parse(dataLine) as ClusterSSEEvent;
          } catch {
            continue;
          }

          if (requestId !== computeSeq) {
            reader.cancel();
            return;
          }

          if (event.type === "progress") {
            useStore.setState({ clusters: event.clusters });
          } else if (event.type === "done") {
            useStore.setState({
              clusters: event.clusters,
              meta: event.meta,
              computeStatus: "done",
              computeError: undefined,
            });
          } else if (event.type === "error") {
            useStore.setState({
              computeStatus: "error",
              computeError: event.message,
            });
          }
        }
      }
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
  overlapFactor: OVERLAP_FACTOR_DEFAULT,
  minRadiusMult: MIN_RADIUS_MULT_DEFAULT,

  clusters: [],
  meta: null,
  computeStatus: "idle",

  showRealCities: true,
  selectedClusterId: null,

  activeRegion: () => {
    const { manifest, regionSlug } = get();
    if (!manifest || !regionSlug) return null;
    return manifest.regions.find((r) => r.slug === regionSlug) ?? null;
  },

  toggleRealCities: () => set((s) => ({ showRealCities: !s.showRealCities })),
  setSelectedClusterId: (id) => set({ selectedClusterId: id }),

  init: async () => {
    if (get().manifest) return;

    // Seed region + params from the URL query if present.
    let urlRegion: string | null = null;
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      urlRegion = sp.get("region");
      const urlK = Number(sp.get("k"));
      if (Number.isFinite(urlK) && urlK > 0) {
        set({ k: Math.max(K_MIN, Math.min(K_MAX, urlK)) });
      }
      const urlOverlap = Number(sp.get("overlapFactor"));
      if (Number.isFinite(urlOverlap) && urlOverlap > 0 && urlOverlap <= 2) {
        set({ overlapFactor: Math.max(OVERLAP_FACTOR_MIN, Math.min(OVERLAP_FACTOR_MAX, urlOverlap)) });
      }
      const urlMult = Number(sp.get("minRadiusMult"));
      if (Number.isFinite(urlMult) && urlMult > 0) {
        set({ minRadiusMult: Math.max(MIN_RADIUS_MULT_MIN, Math.min(MIN_RADIUS_MULT_MAX, urlMult)) });
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
      const { k, overlapFactor, minRadiusMult } = get();
      dispatchCompute(slug, k, overlapFactor, minRadiusMult);
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
    const { regionSlug, dataStatus, overlapFactor, minRadiusMult } = get();
    if (regionSlug && dataStatus === "ready") dispatchCompute(regionSlug, clamped, overlapFactor, minRadiusMult);
  },

  setOverlapFactor: (v: number) => {
    const clamped = Math.max(OVERLAP_FACTOR_MIN, Math.min(OVERLAP_FACTOR_MAX, v));
    set({ overlapFactor: clamped });
    const { regionSlug, dataStatus, k, minRadiusMult } = get();
    if (regionSlug && dataStatus === "ready") dispatchCompute(regionSlug, k, clamped, minRadiusMult);
  },

  setMinRadiusMult: (v: number) => {
    const clamped = Math.max(MIN_RADIUS_MULT_MIN, Math.min(MIN_RADIUS_MULT_MAX, v));
    set({ minRadiusMult: clamped });
    const { regionSlug, dataStatus, k, overlapFactor } = get();
    if (regionSlug && dataStatus === "ready") dispatchCompute(regionSlug, k, overlapFactor, clamped);
  },

  recompute: () => {
    const { regionSlug, k, dataStatus, overlapFactor, minRadiusMult } = get();
    if (regionSlug && dataStatus === "ready") dispatchCompute(regionSlug, k, overlapFactor, minRadiusMult);
  },
}));
