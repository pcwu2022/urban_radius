# Urban Radius Explorer

An interactive web application that visualizes a custom urban-analysis algorithm—the **Urban Radius (R)**—on a live, pannable, and zoomable world map. It challenges the conventional reliance on administrative borders by calculating city boundaries dynamically from underlying population density data.

## What it does

Administrative city borders are notoriously inconsistent and often politically motivated. This project defines "cities" through a pure, data-driven approach inspired by the **H-index** from academia.

By leveraging global population density grids (via H3 Hexagons), the app computes an **Urban Radius (R)** for every population center globally. You can tune a single density constant $k$, and the algorithm automatically re-runs in real-time to show you how cities merge, grow, or shrink as the threshold changes.

## The Urban Radius (R) Concept

If we assume a specific location is the center of a city, we can define a new spatial index—the **Urban Radius "R"**:

> **R** is the maximum radius $r$ where the population density within $r$ kilometers consistently exceeds **k × r** people per square kilometer (where $k$ is a tuning constant).

Because cumulative density decreases as you expand outward, and the linear threshold $k \cdot r$ increases, they eventually cross. This intersection point defines the unique boundary $R$ for that city.

## Algorithm Overview

The core algorithm runs continuously to find cities across the globe. The logic is roughly:

1. **Seeding:** Find all local maxima of population density. These are our candidate seeds.
2. **Mean-Shift:** For each seed, calculate its Urban Radius $R$. Then find the population-weighted centroid of all people within that radius. Move the seed toward this centroid. Repeat until the center stops moving (converges).
3. **Merging:** If two adjacent cities' $R$-boundaries overlap by a certain factor, merge them into a single larger metro area. Repeat the mean-shift process on the combined populations until all clusters are stable and non-overlapping.
4. **Naming:** (Display only) Map the resulting geometric clusters to a gazetteer of real-world cities to label them.

## Tech Stack

- **Next.js 14+ (App Router)** & **TypeScript**
- **MapLibre GL JS** (`react-map-gl`) for high-performance WebGL map rendering.
- **Turf.js** for geometric operations and distances.
- **Tailwind CSS** for the UI.
- Algorithm executes Server-Side (or via Web Workers for smaller datasets) to keep the UI buttery smooth.

## Getting Started

1. Clone the repository.
2. Install dependencies: `npm install`
3. Run the development server: `npm run dev`
4. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Precomputation

To save computation energy for common parameters, you can run the precompute script:

```bash
npx tsx scripts/precompute.ts
```

This caches the results for popular parameter combinations.
