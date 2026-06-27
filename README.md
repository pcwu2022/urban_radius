# Urban Radius Explorer

A Next.js app that detects **data-driven cities** from global population density using
the custom **Urban Radius (R) algorithm**, and visualizes them on an interactive map.
Cities emerge as clusters of the population data itself — not from administrative borders.

Everything (data loading + the clustering computation) runs **client-side**, so the app
exports to fully static files and can be hosted on GitHub Pages.

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
| Algorithm (pure TS) | `lib/algorithm.ts` | No DOM deps; runs in worker or tests |
| Web Worker | `lib/algorithm.worker.ts` | Keeps the main thread free during recompute |
| State + worker lifecycle | `lib/store.ts` | zustand; latest k request always wins |
| Resolution / data config | `lib/dataConfig.ts` | Swap `ACTIVE_RESOLUTION_ID` to retarget |
| Map (3 layers) | `components/MapView.tsx` | MapLibre GL: points, R-circles, centers |
| UI | `components/{Header,Sidebar}.tsx` | Region selector, k slider, results |

### Data pipeline

Source: the [Kontur Population Dataset](https://data.humdata.org/dataset/kontur-population-dataset-22km)
(H3 hexagons, EPSG:3857). The raw GeoPackage lives in `data_src/` (git-ignored, **not**
deployed). A script reprojects each hexagon centroid to lng/lat, buckets it into regions by
bounding box, and writes static GeoJSON + a manifest the app fetches directly:

```bash
python3 scripts/build_regions.py 22km
# -> public/data/res_22km/<region>.geojson  +  regions.json
```

There is intentionally **no `/api/population` server route** (the spec's API route is
replaced by static GeoJSON) so the app stays static-host friendly.

#### Changing resolution

Drop a finer GeoPackage at `data_src/res_<id>/`, add an entry to `RESOLUTIONS` in
`scripts/build_regions.py`, regenerate, then set `ACTIVE_RESOLUTION_ID` in `lib/dataConfig.ts`.

## Build & deploy (GitHub Pages)

```bash
npm run build        # static export -> ./out
```

For a project page served under a sub-path, set the base path so asset/data URLs resolve:

```bash
BASE_PATH=/your-repo-name npm run build
```

`BASE_PATH` is wired into `next.config.mjs` (`basePath`) and exposed to the client as
`NEXT_PUBLIC_BASE_PATH`, which `lib/dataConfig.ts` prefixes onto every data fetch. Publish
the `out/` directory (e.g. with `gh-pages -d out`).

## Honesty about guarantees

- **Guaranteed:** R(c) is unique for any fixed center; the merge loop terminates.
- **Empirical, not guaranteed:** that mean-shift converges without oscillation for every
  seed, and that there's a single "correct" k — picking a useful k range is per-region tuning.
