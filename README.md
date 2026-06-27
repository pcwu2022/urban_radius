# Urban Radius Explorer

A Next.js app that detects **data-driven cities** from global population density using
the custom **Urban Radius (R) algorithm**, and visualizes them on an interactive map.
Cities emerge as clusters of the population data itself — not from administrative borders.

Data processing and the clustering computation run **server-side** (API routes), because
the high-resolution grids — ~0.5M nodes per continent at 3 km — are too large to ship to
the browser. The app therefore requires a Node server (`next start`); it is not a static
export.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Use the **Region** selector (top right) to load a continent and the **k** slider (sidebar)
to tune the algorithm. Releasing the slider re-runs the full algorithm in a Web Worker.

## How it works

### The algorithm (`lib/algorithm.ts`)

For a candidate center `c`, **R(c)** is the largest radius `r` such that the cumulative
population density `ρ(r) = pop/(π r²)` stays above the line `k·r` for every radius up to `r`.
Because `ρ` is non-increasing and `k·r` increases, the two cross exactly once, so R is unique.

The full pipeline:

1. **Seed** at every local maximum of population density (deterministic).
2. **Adaptive mean-shift** from each seed: recompute R, move toward the population-weighted
   centroid of the nodes inside R, repeat until the center stops moving. The bandwidth (R)
   is recomputed every step, so the search is self-tuning.
3. **Merge** clusters whose R-disks overlap (`dist(cᵢ,cⱼ) < Rᵢ+Rⱼ`), transitively via
   connected components, recomputing each merged cluster until a pass yields zero merges.

A uniform spatial grid keeps each R(c) evaluation ~O(nodes within R); a full region
(~18k hexagons) clusters in well under a second.

`k` has units of people/km³ and controls everything: low k → large, merged metros;
high k → tight dense cores.

### Architecture

| Piece | File | Notes |
| --- | --- | --- |
| Algorithm (pure TS) | `lib/algorithm.ts` | No DOM deps; runs on the server or in tests. Grid-based seeding + R evaluation keeps it near-linear at ~0.5M nodes |
| Server data + algorithm | `lib/serverData.ts` | Loads/caches region nodes, runs & caches clustering. `server-only` |
| API routes | `app/api/{population,clusters}/route.ts` | Display points (downsampled) and clustering results |
| Client state | `lib/store.ts` | zustand; fetches the APIs, latest-k-request wins (AbortController) |
| Resolution / data config | `lib/dataConfig.ts` | Swap `ACTIVE_RESOLUTION_ID` to retarget |
| Map (3 layers) | `components/MapView.tsx` | MapLibre GL: points, R-circles, centers |
| UI | `components/{Header,Sidebar}.tsx` | Region selector, k slider, results |

The client never downloads the full grid. It fetches:
- `GET /api/population?region=…` — a bounded, downsampled set of the **densest** points
  (capped at 50k) for the dots layer;
- `GET /api/clusters?region=…&k=…` — the algorithm output, computed server-side on the
  **full** node set and cached per `(region, k)`.

### Data pipeline

Source: the [Kontur Population Dataset](https://data.humdata.org/dataset/kontur-population-dataset)
(H3 hexagons, EPSG:3857). Raw GeoPackages live in `data_src/res_<id>/` (git-ignored). A script
reprojects each hexagon centroid to lng/lat, buckets it into regions by bounding box, and writes
per-region GeoJSON + a manifest into `public/data/res_<id>/`:

```bash
python3 scripts/build_regions.py 22km
python3 scripts/build_regions.py 3km    # ~280 MB of GeoJSON; read server-side, git-ignored
```

The server reads these files from disk (it does **not** serve the full sets to the client).
The small per-region `regions.json` manifest is fetched directly by the client.

#### Changing resolution

Drop a GeoPackage at `data_src/res_<id>/`, ensure an entry exists in `RESOLUTIONS`
(`scripts/build_regions.py`) and `DATA_RESOLUTIONS` (`lib/dataConfig.ts`), regenerate, then
set `ACTIVE_RESOLUTION_ID` in `lib/dataConfig.ts`. The radius filter and display cap scale
automatically.

## Build & run

```bash
npm run build
npm start             # Node server on :3000 (required — there is no static export)
```

Optionally host under a sub-path with `BASE_PATH=/your-path` (wired into `next.config.mjs`
and exposed as `NEXT_PUBLIC_BASE_PATH`).

### Performance notes

Clustering a continent at 3 km takes ~4–7 s at typical k (up to ~19 s at the extreme low-k
end on the largest region); results are cached per `(region, k)`, so repeats are instant.
First access to a region also parses its GeoJSON once (~1 s) and caches the nodes in memory.

## Honesty about guarantees

- **Guaranteed:** R(c) is unique for any fixed center; the merge loop terminates.
- **Empirical, not guaranteed:** that mean-shift converges without oscillation for every
  seed, and that there's a single "correct" k — picking a useful k range is per-region tuning.
