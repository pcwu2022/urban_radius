"use client";

/**
 * The interactive map (spec.md Section 7). Renders layers over a tracking-free
 * raster basemap:
 *   - Layer 1:  population points      (WebGL circle layer, styled by `population`)
 *   - Layer 2a: city R boundaries      (geodesic circles from @turf/circle, line + fill)
 *   - Layer 2b: city centres           (marker circle layer, red)
 *   - Layer 2c: city name labels
 *   - Layer 3:  real city positions    (gazetteer dots, blue — toggleable)
 *
 * The MapLibre map is created once. Store changes only push data into existing
 * sources / update paint properties, so pan & zoom never trigger recomputation.
 */

import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap, type StyleSpecification } from "maplibre-gl";
import { circle as turfCircle } from "@turf/turf";
import "maplibre-gl/dist/maplibre-gl.css";

import { useStore } from "@/lib/store";
import type { Cluster, PopNode } from "@/lib/types";

// Key-free CARTO raster basemap (no tracking / no token).
const BASE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      ],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [{ id: "carto", type: "raster", source: "carto" }],
};

const SRC_POP = "population";
const SRC_CIRCLES = "city-circles";
const SRC_CENTERS = "city-centers";
const SRC_REAL_CITIES = "real-cities";

function popFeatureCollection(nodes: PopNode[]) {
  return {
    type: "FeatureCollection" as const,
    features: nodes.map((n) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [n.lng, n.lat] },
      properties: { population: n.population },
    })),
  };
}

function circlesFeatureCollection(clusters: Cluster[]) {
  return {
    type: "FeatureCollection" as const,
    features: clusters.map((c) =>
      turfCircle([c.center.lng, c.center.lat], c.radiusKm, {
        steps: 64,
        units: "kilometers",
        properties: {
          id: c.id,
          name: c.name ?? "",
          radiusKm: Math.round(c.radiusKm * 10) / 10,
          population: c.totalPopulation,
          lng: c.center.lng,
          lat: c.center.lat,
        },
      })
    ),
  };
}

function centersFeatureCollection(clusters: Cluster[]) {
  return {
    type: "FeatureCollection" as const,
    features: clusters.map((c) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [c.center.lng, c.center.lat] },
      properties: {
        id: c.id,
        name: c.name ?? "",
        radiusKm: Math.round(c.radiusKm * 10) / 10,
        population: c.totalPopulation,
      },
    })),
  };
}

/** Real (gazetteer) city positions for clusters that have a matched city. */
function realCitiesFeatureCollection(clusters: Cluster[]) {
  return {
    type: "FeatureCollection" as const,
    features: clusters
      .filter((c) => c.matchedCity !== undefined)
      .map((c) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [c.matchedCity!.lon, c.matchedCity!.lat],
        },
        properties: {
          id: c.id,
          name: c.matchedCity!.name,
          country: c.matchedCity!.country,
          realPop: c.matchedCity!.pop,
          rank: c.matchedCity!.rank,
          calcPop: c.totalPopulation,
        },
      })),
  };
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);

  // create the map once
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const map = new maplibregl.Map({
      container,
      style: BASE_STYLE,
      center: [10, 30],
      zoom: 2,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

    // The container's final flex/absolute size may not be resolved at construction
    // time (the map can come up at MapLibre's fallback ~400×300), so keep the canvas
    // synced to the container. ResizeObserver fires once immediately on observe()
    // and on every subsequent layout change (e.g. window resize).
    const resizeObserver = new ResizeObserver(() => {
      if (map) {
        map.resize();
      }
    });
    resizeObserver.observe(container);

    // Force an immediate layout recalculation on the next animation frame
    requestAnimationFrame(() => {
      map.resize();
    });

    map.on("load", () => {
      // sources
      map.addSource(SRC_POP, { type: "geojson", data: popFeatureCollection([]) });
      map.addSource(SRC_CIRCLES, { type: "geojson", data: circlesFeatureCollection([]) });
      map.addSource(SRC_CENTERS, { type: "geojson", data: centersFeatureCollection([]) });
      map.addSource(SRC_REAL_CITIES, { type: "geojson", data: realCitiesFeatureCollection([]) });

      // Layer 1: population points
      map.addLayer({
        id: "population-points",
        type: "circle",
        source: SRC_POP,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["get", "population"],
            0, 1.5,
            5000, 2.5,
            50000, 4,
            500000, 7,
            5000000, 12,
          ],
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "population"],
            0, "#fde725",
            50000, "#5ec962",
            500000, "#21918c",
            2000000, "#3b528b",
            8000000, "#440154",
          ],
          "circle-opacity": 0.65,
          "circle-stroke-width": 0,
        },
      });

      // Layer 2a: city R boundary (translucent fill + crisp outline)
      map.addLayer({
        id: "city-fill",
        type: "fill",
        source: SRC_CIRCLES,
        paint: { "fill-color": "#e11d48", "fill-opacity": 0.08 },
      });
      map.addLayer({
        id: "city-outline",
        type: "line",
        source: SRC_CIRCLES,
        paint: { "line-color": "#e11d48", "line-width": 2, "line-opacity": 0.9 },
      });

      // Layer 2b: city centres (algorithm result — red)
      map.addLayer({
        id: "city-centers",
        type: "circle",
        source: SRC_CENTERS,
        paint: {
          "circle-radius": 5,
          "circle-color": "#e11d48",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });

      // Layer 2c: city name labels (only for named clusters)
      map.addLayer({
        id: "city-labels",
        type: "symbol",
        source: SRC_CENTERS,
        filter: ["!=", ["get", "name"], ""],
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Regular"],
          "text-size": 12,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-allow-overlap": false,
          "text-optional": true,
        },
        paint: {
          "text-color": "#881337",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });

      // Layer 3: Real (gazetteer) city positions — distinct blue/teal dots
      map.addLayer({
        id: "real-city-dots",
        type: "circle",
        source: SRC_REAL_CITIES,
        paint: {
          "circle-radius": 6,
          "circle-color": "#0ea5e9",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": 0.9,
        },
      });

      // Layer 3b: Real city name labels
      map.addLayer({
        id: "real-city-labels",
        type: "symbol",
        source: SRC_REAL_CITIES,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Open Sans Regular"],
          "text-size": 11,
          "text-offset": [0, -1.2],
          "text-anchor": "bottom",
          "text-allow-overlap": false,
          "text-optional": true,
        },
        paint: {
          "text-color": "#0369a1",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });

      readyRef.current = true;
      // push whatever is already in the store
      const s = useStore.getState();
      pushData(map, s.nodes, s.clusters);
      applyDim(map, s.computeStatus === "computing");
      applyRealCitiesVisibility(map, s.showRealCities);

      // Clicking a real city dot opens an info popup
      const popup = new maplibregl.Popup({ closeButton: false, offset: 10 });

      const showClusterPopup = (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as {
          name?: string;
          radiusKm: number;
          population: number;
          lng?: number;
          lat?: number;
        };
        // anchor at the cluster centre when available (fill), else the feature point
        const lngLat: [number, number] =
          p.lng !== undefined && p.lat !== undefined
            ? [Number(p.lng), Number(p.lat)]
            : ((f.geometry as GeoJSON.Point).coordinates as [number, number]);
        const title = p.name ? p.name : "Unnamed cluster";
        popup
          .setLngLat(lngLat)
          .setHTML(
            `<div style="font:12px system-ui"><b>${escapeHtml(title)}</b><br/>` +
              `R = ${p.radiusKm} km<br/>` +
              `pop = ${formatPop(Number(p.population))}</div>`
          )
          .addTo(map);
      };

      const showRealCityPopup = (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as {
          name: string;
          country: string;
          realPop: number;
          rank: number;
          calcPop: number;
        };
        const coverage = p.calcPop > 0 && p.realPop > 0
          ? `${((p.calcPop / p.realPop) * 100).toFixed(0)}%`
          : "–";
        const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        popup
          .setLngLat(coords)
          .setHTML(
            `<div style="font:12px system-ui">` +
            `<b style="color:#0369a1">📍 ${escapeHtml(p.name)} (${escapeHtml(p.country)})</b><br/>` +
            `<span style="color:#555">Real position</span><br/>` +
            `Real pop: ${formatPop(Number(p.realPop))}<br/>` +
            `Calc pop: ${formatPop(Number(p.calcPop))} (${coverage} of real)<br/>` +
            `Gazetteer rank: #${p.rank}` +
            `</div>`
          )
          .addTo(map);
      };

      for (const layer of ["city-fill", "city-centers"]) {
        map.on("click", layer, showClusterPopup);
        map.on("mouseenter", layer, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      map.on("click", "real-city-dots", showRealCityPopup);
      map.on("mouseenter", "real-city-dots", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "real-city-dots", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // push node + cluster data into sources whenever they change
  const nodes = useStore((s) => s.nodes);
  const clusters = useStore((s) => s.clusters);
  const computeStatus = useStore((s) => s.computeStatus);
  const dataStatus = useStore((s) => s.dataStatus);
  const regionSlug = useStore((s) => s.regionSlug);
  const activeRegion = useStore((s) => s.activeRegion);
  const showRealCities = useStore((s) => s.showRealCities);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    pushData(map, nodes, clusters);
  }, [nodes, clusters]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyDim(map, computeStatus === "computing");
  }, [computeStatus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyRealCitiesVisibility(map, showRealCities);
  }, [showRealCities]);

  // fly to region on selection change
  useEffect(() => {
    const map = mapRef.current;
    const region = activeRegion();
    if (!map || !region) return;
    map.flyTo({ center: region.center, zoom: region.zoom, duration: 1200 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionSlug]);

  const loadingRegion = dataStatus === "loading";
  const computing = computeStatus === "computing";
  const busy = loadingRegion || computing;
  const busyLabel = loadingRegion ? "Loading region…" : "Computing cities…";

  return (
    <div ref={containerRef} className="absolute inset-0">
      {busy && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-rose-200 bg-white/95 px-4 py-2 text-sm font-semibold text-rose-700 shadow-lg ring-1 ring-rose-500/10 backdrop-blur">
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-rose-300 border-t-rose-600"
              aria-hidden
            />
            {busyLabel}
          </div>
        </div>
      )}
    </div>
  );
}

function pushData(map: MlMap, nodes: PopNode[], clusters: Cluster[]) {
  (map.getSource(SRC_POP) as maplibregl.GeoJSONSource | undefined)?.setData(
    popFeatureCollection(nodes)
  );
  (map.getSource(SRC_CIRCLES) as maplibregl.GeoJSONSource | undefined)?.setData(
    circlesFeatureCollection(clusters)
  );
  (map.getSource(SRC_CENTERS) as maplibregl.GeoJSONSource | undefined)?.setData(
    centersFeatureCollection(clusters)
  );
  (map.getSource(SRC_REAL_CITIES) as maplibregl.GeoJSONSource | undefined)?.setData(
    realCitiesFeatureCollection(clusters)
  );
}

/** Dim the cluster layers while a recomputation is in flight (Section 6.2). */
function applyDim(map: MlMap, computing: boolean) {
  const fill = computing ? 0.03 : 0.08;
  const line = computing ? 0.3 : 0.9;
  const center = computing ? 0.35 : 1;
  if (map.getLayer("city-fill")) map.setPaintProperty("city-fill", "fill-opacity", fill);
  if (map.getLayer("city-outline"))
    map.setPaintProperty("city-outline", "line-opacity", line);
  if (map.getLayer("city-centers"))
    map.setPaintProperty("city-centers", "circle-opacity", center);
}

/** Show or hide the real city position layers. */
function applyRealCitiesVisibility(map: MlMap, visible: boolean) {
  const v = visible ? "visible" : "none";
  if (map.getLayer("real-city-dots"))
    map.setLayoutProperty("real-city-dots", "visibility", v);
  if (map.getLayer("real-city-labels"))
    map.setLayoutProperty("real-city-labels", "visibility", v);
}

function formatPop(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${n}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
