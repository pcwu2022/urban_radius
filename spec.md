# Urban Radius Explorer — Web App Specification

**This document is fully self-contained.** It includes the complete algorithm definition, data architecture, configuration setup, and UI/architecture spec needed to build this app from scratch. No other document or prior context is required to implement it.

---

## 0. What this app is

A Next.js web application that visualizes a custom urban-analysis algorithm — called the **Urban Radius (R) algorithm** — on a real, pannable/zoomable world map. The app:

1. Loads global population distribution data partitioned by chosen geographic regions.
2. Runs a clustering algorithm (defined in full in Section 1) on that data, entirely in the browser, to detect "cities" as data-driven clusters rather than using official administrative borders.
3. Draws two layers on the map: the raw population data points (derived from H3 Hexagons), and the algorithm's output (detected city centers and their radii).
4. Lets the user adjust a single tuning constant, **k**, via a slider. Changing k triggers a full re-run of the algorithm and updates the map.
5. Lets the user freely pan and zoom the map without triggering recomputation.

---

## 1. The Urban Radius Algorithm — Full Definition

This section is the complete, standalone specification of the algorithm. It is inspired by the h-index (used to measure a researcher's impact: an author has h-index H if H of their papers have at least H citations each). The same self-referential, threshold-crossing idea is applied here to detect city boundaries from population data, instead of using arbitrary administrative borders.

### 1.1 Core concepts and notation

| Symbol | Meaning |
| --- | --- |
| **Node** | A single data point representing population at a specific location: `{ lng, lat, population }`. Nodes are derived from the centroids of the population dataset's hexagons. |
| **c** | A candidate city center — a point (lng, lat), not necessarily one of the input nodes. |
| **ρ(r, c)** ("cumulative density") | The total population within distance r of center c, divided by the area of that circle (π·r²). Units: people/km². |
| **k** | The single tuning constant of the whole algorithm. Units: people/km³ (people per km² per km of radius — see Section 1.2 for why). This is the one value the UI lets the user adjust. |
| **R(c)** ("Urban Radius") | The output of the core algorithm for a fixed center c — see Section 1.2. |

### 1.2 Urban Radius — the core definition

For a fixed candidate center **c**, define:

> **R(c) = the largest r such that ρ(r′, c) > k·r′ holds for every r′ from 0 up to r (no gaps allowed).**

In other words: as r grows outward from the center, cumulative population density ρ(r, c) naturally decreases (the further out you go, the more low-density land you're averaging in), while k·r is a straight line that increases. R is the point where these two curves first cross — the radius at which the city "stops being dense enough" relative to the k·r threshold.

**Why this is well-defined (always has a unique answer):** Because ρ(r, c) is non-increasing as r grows (true for cumulative density measured outward from a density peak) and k·r is strictly increasing from 0, the difference `ρ(r,c) − k·r` is strictly decreasing in r. A strictly decreasing function crosses zero **at most once**. So R(c) is unique — there's no ambiguity from multiple crossings or gaps.

**Practical computation:** Sort all nodes by distance from c. Walk outward, accumulating population. At each node's distance r, check whether (cumulative population so far) / (π·r²) is still greater than k·r. The last distance at which this is still true is R(c). See Section 9.3 for the exact pseudocode.

**Units note:** ρ has units of people/km². For k·r to be comparable, k must have units of people/km³ (i.e., people/km² per km). This means k is not a free dimensionless number — it's tied to real physical units, and changing units (e.g., km vs. miles) changes the effective k. This app always works in kilometers.

### 1.3 Finding a city center (not just evaluating R at a fixed point)

R(c) is defined for any fixed center c, but the real goal is to find the centers themselves — the algorithm needs to discover where cities are, not just measure a given point.

**Method: adaptive mean-shift.** This is a fixed-point iteration:

1. Start at some candidate location c (a "seed" — see Section 1.4 for how seeds are chosen).
2. Compute R(c) using the rule in Section 1.2.
3. Compute the population-weighted centroid of all nodes within distance R(c) of c. Call this c′.
4. Move c partway toward c′ (a damped step — see below for why), producing a new c.
5. Repeat from step 2 until c stops moving meaningfully (converges).

**Why damping (a partial step, not a full jump to the centroid):** Because R itself depends on the current center, and the center depends on R, this is a coupled system that can in principle oscillate — c could jump back and forth between two nearby density peaks as R alternately expands to include or shrinks to exclude a neighboring dense area. Moving only partway toward the new centroid each step (e.g., 50–100% of the way, controlled by a damping factor α) damps out this kind of oscillation. Start with α = 1 (full step) and only reduce it if oscillation is observed in practice.

This is mathematically very close to the "mean-shift" algorithm used in computer vision/clustering, except that the radius (bandwidth) is not a fixed constant chosen in advance — it's recomputed at every step from R(c), making the whole thing self-tuning.

### 1.4 Choosing where to start (seeding)

The mean-shift procedure in Section 1.3 needs a starting point. To make results reproducible (not dependent on random starting guesses), seed at **every local maximum of population density** in the input data. Concretely: for each node, check whether its local population density is higher than its nearby neighbors' — if so, it's a seed. (A simple grid-based or k-nearest-neighbor-based local-maximum check is sufficient; this doesn't need to be sophisticated.)

This is deterministic — the same input data always produces the same seed set — which means the final result also doesn't depend on arbitrary choices.

### 1.5 Merging overlapping cities

Running Section 1.3 from every seed produces a set of candidate (center, R) pairs. Some of these will be near-duplicates or overlapping — e.g., two seeds in the same metro area might converge to two nearby but distinct centers. These need to be merged into one city.

**Merge rule:** Two clusters i and j (with centers c_i, c_j and radii R_i, R_j) should be merged if their R-disks overlap at all:

> **merge(i, j) if and only if distance(c_i, c_j) < R_i + R_j**

This is symmetric (treats both clusters identically) and only triggers when there's genuine spatial overlap between the two detected urban regions.

**Merging procedure (must be order-independent):**

1. Scan all pairs of current clusters and collect every pair that satisfies the merge condition above.
2. Merge all flagged pairs *transitively* — if cluster A overlaps B, and B overlaps C, then A, B, and C all become one merged cluster (even if A and C don't directly overlap). This is exactly the "connected components" operation on a graph where clusters are nodes and overlap-pairs are edges.
3. For each newly merged cluster, recompute its center and R by re-running the Section 1.3 procedure on the combined set of member nodes, starting from the combined centroid.
4. Repeat steps 1–3 (a full pass over all current clusters) until one entire pass produces zero merges.

**Why this terminates:** The number of clusters is a positive integer that strictly decreases every time a merge happens. A strictly decreasing sequence of positive integers must reach a fixed point in a finite number of steps — so this process is guaranteed to terminate (in at most N−1 rounds, where N is the initial seed count).

### 1.6 What is and isn't guaranteed (be honest about this in the UI)

* **Guaranteed:** R(c) is unique for any fixed center (Section 1.2). The merge loop terminates (Section 1.5).
* **Not guaranteed, should be observed/tested empirically:** The mean-shift loop (Section 1.3) converging without oscillation for every seed; every seed within what a human would intuitively call "one city" converging to the same final center (rather than splitting into two nearby, non-merging results).
* **k controls everything about the output shape.** Very small k makes R grow large, merging wide areas into one city. Very large k shrinks R, fragmenting cities into small pockets. There's no automatic "correct" k — picking a useful range for the slider (Section 8) is a matter of empirical tuning per region.

---

## 2. Goals and Non-Goals

### Goals

* Use real global population density data sourced from Kontur population grids.
* Provide fluid interactive k-tuning: releasing the slider triggers a full, exact re-run of the algorithm (not an approximation or cached interpolation).
* Maintain responsive map interactions (pan/zoom) using a native map rendering library.
* Allow simple structural scalability to shift resolutions via configuration adjustments.

### Non-Goals

* Whole-country, all-cities-at-once global computation in a single thread pass. The app operates on one selected sub-region or bounding cluster at a time.
* Real-time/streaming updates during slider dragging. Each k change is a discrete, full recomputation on slider release.

---

## 3. Tech Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js 14+ (App Router), TypeScript** | Modern rendering architectures and robust types. |
| Map rendering | **MapLibre GL JS** (via `react-map-gl`) | High performance WebGL mapping without tracking requirements. |
| Geometry helpers | **Turf.js** (`@turf/turf`) | Needed for distance calculations, centroid generation, and bounding boxes. |
| Spatial Indexing | **H3-js** | For future-proof support of H3 Hexagon resolutions and client-side geometric handling if needed. |
| Algorithm execution | Plain TypeScript, run inside a **Web Worker** | Keeps map interactions and UI responsiveness isolated from hefty computation blocks. |
| Styling | **Tailwind CSS** | Fast development workflow for control panels and sidebars. |

---

## 4. Information Architecture / Page Layout

Single page app, one view:

```
┌─────────────────────────────────────────────────────────────┐
│  Header: "Urban Radius Explorer"        [Region Selector ▾] │
├───────────────────────────────────────────────┬─────────────┤
│                                               │   Sidebar   │
│                                               │             │
│                                               │  k Slider   │
│               MAP (pan / zoom)                │  k Value    │
│                                               │             │
│        • dots (hexagon centroids)             │  Results:   │
│        ○ circles (city R boundaries)          │  - City A   │
│        + centers (city center markers)        │    R=24.0km │
│                                               │    pop=4.2M │
│                                               │             │
│                                               │  Resolution │
│                                               │  Info Layer │
└───────────────────────────────────────────────┴─────────────┘

```

---

## 5. Data Layer & Resolution Configurations

### 5.1 Primary Data Source

The data is sourced from the **Kontur Population Dataset**, which tracks Global Population Density for H3 Hexagons. The production environment utilizes pre-downloaded fragments of this data organized into queryable geographic segments.

### 5.2 Resolution Configuration Matrix

To allow swapping out resolutions seamlessly (e.g., migrating from the default 22km hexagons down to 3km or 400m fine grids), the system abstracts data ingestion behind explicit configuration environments.

Create a configuration file at `/lib/dataConfig.ts`:

```typescript
export interface ResolutionConfig {
  id: string;
  name: string;
  h3Resolution: number;
  averageEdgeLengthKm: number;
  dataSourceUrl: string;
  dataPath: string;
}

export const DATA_RESOLUTIONS: Record<string, ResolutionConfig> = {
  "22km": {
    id: "22km",
    name: "Global 22km H3 Grid (Resolution 4)",
    h3Resolution: 4,
    averageEdgeLengthKm: 22.61,
    dataSourceUrl: "https://data.humdata.org/dataset/kontur-population-dataset-22km",
    dataPath: "/public/data/res_22km/"
  },
  "3km": {
    id: "3km",
    name: "Global 3km H3 Grid (Resolution 7)",
    h3Resolution: 7,
    averageEdgeLengthKm: 2.83,
    dataSourceUrl: "https://data.humdata.org/dataset/kontur-population-dataset-3km", // Future placeholder
    dataPath: "/public/data/res_3km/"
  },
  "400m": {
    id: "400m",
    name: "Global 400m H3 Grid (Resolution 9)",
    h3Resolution: 9,
    averageEdgeLengthKm: 0.45,
    dataSourceUrl: "https://data.humdata.org/dataset/kontur-population-dataset-400m", // Future placeholder
    dataPath: "/public/data/res_400m/"
  }
};

// Toggle this variable to instantly target alternate resolutions across the application
export const ACTIVE_RESOLUTION_ID: string = "22km";

export const ACTIVE_CONFIG: ResolutionConfig = DATA_RESOLUTIONS[ACTIVE_RESOLUTION_ID];

```

### 5.3 Processing Model into Nodes

The downloaded dataset contains H3 spatial indexes mapped to population metrics. The application consumes these files pre-rendered or split via a standard schema structure:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [-74.006, 40.7128] },
      "properties": { "population": 45100, "h3Index": "842a107ffffffff" }
    }
  ]
}

```

*Note: The geometry point represents the precise spatial centroid of the corresponding H3 hexagon.*

### 5.4 Application API Route

Regardless of the underlying active configuration setting, the client UI queries data dynamically via an internal handler:

```
GET /api/population?region={region-slug}

```

The server reads the filesystem assets corresponding to `ACTIVE_CONFIG.dataPath + region-slug.geojson`, optimizing response times with uniform caching policies.

---

## 6. Core Interaction Flow

### 6.1 Initial Load

1. The client requests the active spatial collection for a baseline region.
2. Map flies directly to the configured bounding region coordinates.
3. Node markers render as a unified layer instantly upon completion of the network download.
4. The calculation engine processes data asynchronously inside the Web Worker scope using the baseline `k` scale.
5. Computed center tags and radius boundaries render overlay graphics cleanly.

### 6.2 Changing k

* Dragging the interactive slider adjusts the UI's local display metrics smoothly.
* On **slider release** (pointer-up event sequence), the updated metric commits, dispatching a payload cycle to the running background Web Worker.
* Prior results remain structurally visible with dropped opacity styling states during concurrent processing frames to prevent jarring interface flashes.

---

## 7. Map Layers — Rendering Detail

### 7.1 Layer 1: Population Points

* Rendered via a native MapLibre WebGL **circle layer** for massive performance advantages over individual DOM attachments.
* Circle styling parameters utilize dynamic mathematical expressions base-scaled against the raw `population` property field.

### 7.2 Layer 2: Cluster Bounds

* **Centers:** Visible standalone nodes highlighting absolute converged spatial weights.
* **Radii:** Geodesic circle paths generated via `@turf/circle` utilizing exact kilometer output arrays (`radiusKm`) returned from the computation framework. They scale and warp accurately across coordinate space upon zoom interactions.

---

## 8. Web Worker Execution Model

To guarantee uniform UI frames and interrupt-free panning, execution logic shifts out of the browser main thread context.

### 9.1 Worker Input Types

```ts
type WorkerInput = {
  nodes: { lng: number; lat: number; population: number }[];
  k: number;
  epsilon: number; // Convergence tolerance for center movement (e.g., 0.05 km)
  alpha: number;   // Damping factor for mean-shift steps (0 < alpha <= 1)
};

```

### 9.2 Worker Output Types

```ts
type WorkerOutput = {
  clusters: {
    id: string;
    center: { lng: number; lat: number };
    radiusKm: number;
    totalPopulation: number;
    memberNodeCount: number;
  }[];
  meta: {
    seedCount: number;
    executionTimeMs: number;
  };
};

```