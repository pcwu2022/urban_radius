/**
 * Resolution + data-source configuration.
 *
 * The app reads population data as *static* GeoJSON assets under
 * `public/data/res_<id>/`. There is intentionally no server-side API route, so the
 * whole app can be exported with `next build` (output: 'export') and hosted on a
 * static host such as GitHub Pages. Swapping `ACTIVE_RESOLUTION_ID` retargets every
 * data path across the application.
 */

export interface ResolutionConfig {
  id: string;
  name: string;
  h3Resolution: number;
  averageEdgeLengthKm: number;
  dataSourceUrl: string;
  /** Public URL path (relative to site root) where region GeoJSON files live. */
  dataPath: string;
}

export const DATA_RESOLUTIONS: Record<string, ResolutionConfig> = {
  "22km": {
    id: "22km",
    name: "Global 22km H3 Grid (Resolution 4)",
    h3Resolution: 4,
    averageEdgeLengthKm: 22.61,
    dataSourceUrl: "https://data.humdata.org/dataset/kontur-population-dataset-22km",
    dataPath: "/data/res_22km/",
  },
  "3km": {
    id: "3km",
    name: "Global 3km H3 Grid (Resolution 7)",
    h3Resolution: 7,
    averageEdgeLengthKm: 2.83,
    dataSourceUrl: "https://data.humdata.org/dataset/kontur-population-dataset-3km", // Future placeholder
    dataPath: "/data/res_3km/",
  },
  "400m": {
    id: "400m",
    name: "Global 400m H3 Grid (Resolution 9)",
    h3Resolution: 9,
    averageEdgeLengthKm: 0.45,
    dataSourceUrl: "https://data.humdata.org/dataset/kontur-population-dataset-400m", // Future placeholder
    dataPath: "/data/res_400m/",
  },
};

// Toggle this variable to instantly target alternate resolutions across the application.
export const ACTIVE_RESOLUTION_ID: string = "22km";

export const ACTIVE_CONFIG: ResolutionConfig = DATA_RESOLUTIONS[ACTIVE_RESOLUTION_ID];

/**
 * Base path the site is served under (e.g. "/urban-radius" for project GitHub Pages).
 * Set NEXT_PUBLIC_BASE_PATH at build time to match `basePath` in next.config.mjs.
 */
export const BASE_PATH: string = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Resolve a public asset path into a fetchable URL, honouring BASE_PATH. */
export function assetUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${clean}`;
}

/** URL of the regions manifest for the active resolution. */
export function regionsManifestUrl(): string {
  return assetUrl(`${ACTIVE_CONFIG.dataPath}regions.json`);
}

/** URL of a single region's GeoJSON for the active resolution. */
export function regionGeojsonUrl(slug: string): string {
  return assetUrl(`${ACTIVE_CONFIG.dataPath}${slug}.geojson`);
}
