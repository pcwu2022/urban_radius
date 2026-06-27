#!/usr/bin/env python3
"""
Build per-region GeoJSON files from the Kontur Population GeoPackage.

The raw Kontur dataset (public/data/res_<id>/kontur_population_<id>.gpkg) stores one
H3 hexagon per row, with geometry in EPSG:3857 (Web Mercator). This script:

  1. Reads each hexagon's bounding-box centre from the GeoPackageBinary header,
  2. Reprojects it to lng/lat (EPSG:4326),
  3. Buckets each centroid into one or more named regions (by bounding box),
  4. Writes a GeoJSON FeatureCollection of Point centroids per region, and
  5. Writes a regions.json manifest the web app uses to populate the region selector.

Output matches the schema in spec.md Section 5.3 so the browser can consume the files
directly as static assets (no server-side processing -> works on GitHub Pages).

Usage:
    python3 scripts/build_regions.py [resolution_id]   # default: 22km
"""

import json
import math
import os
import sqlite3
import struct
import sys

# ---------------------------------------------------------------------------
# Resolution / IO configuration (mirrors lib/dataConfig.ts)
# ---------------------------------------------------------------------------
RESOLUTIONS = {
    "22km": "kontur_population_22km.gpkg",
    "3km": "kontur_population_3km.gpkg",
    "400m": "kontur_population_400m.gpkg",
}

# ---------------------------------------------------------------------------
# Region definitions: slug -> bounding box (lng_min, lat_min, lng_max, lat_max),
# plus a map view (centre + zoom) the app flies to when the region is selected.
# A hexagon centroid is included in every region whose bbox contains it.
# ---------------------------------------------------------------------------
REGIONS = {
    "north-america": {
        "name": "North America",
        "bbox": [-170.0, 7.0, -52.0, 72.0],
        "center": [-100.0, 40.0],
        "zoom": 3,
    },
    "south-america": {
        "name": "South America",
        "bbox": [-93.0, -56.0, -32.0, 14.0],
        "center": [-60.0, -20.0],
        "zoom": 3,
    },
    "europe": {
        "name": "Europe",
        "bbox": [-25.0, 34.0, 45.0, 72.0],
        "center": [12.0, 52.0],
        "zoom": 3.5,
    },
    "africa": {
        "name": "Africa & Middle East",
        "bbox": [-20.0, -36.0, 60.0, 40.0],
        "center": [20.0, 5.0],
        "zoom": 3,
    },
    "asia": {
        "name": "Asia",
        "bbox": [60.0, 5.0, 150.0, 78.0],
        "center": [100.0, 35.0],
        "zoom": 3,
    },
    "oceania": {
        "name": "Oceania",
        "bbox": [110.0, -50.0, 180.0, -8.0],
        "center": [145.0, -28.0],
        "zoom": 3.5,
    },
}

MERC_R = 6378137.0  # Web Mercator sphere radius (EPSG:3857)


def gpb_centroid(blob):
    """Return (lng, lat) of a GeoPackageBinary geometry's bounding-box centre.

    For an H3 hexagon the bbox centre is an excellent approximation of the true
    centroid, and reading it from the envelope header avoids parsing the WKB ring.
    """
    if blob[0] != 0x47 or blob[1] != 0x50:  # magic 'GP'
        raise ValueError("not a GeoPackageBinary blob")
    flags = blob[3]
    little = flags & 0x01
    env_code = (flags >> 1) & 0x07
    env_doubles = {0: 0, 1: 4, 2: 6, 3: 6, 4: 8}[env_code]
    if env_doubles < 4:
        raise ValueError("geometry has no envelope; WKB parsing not implemented")
    endian = "<" if little else ">"
    minx, maxx, miny, maxy = struct.unpack(endian + "dddd", blob[8:40])
    x = (minx + maxx) / 2.0
    y = (miny + maxy) / 2.0
    lng = x / MERC_R * 180.0 / math.pi
    lat = (2.0 * math.atan(math.exp(y / MERC_R)) - math.pi / 2.0) * 180.0 / math.pi
    return lng, lat


def in_bbox(lng, lat, bbox):
    return bbox[0] <= lng <= bbox[2] and bbox[1] <= lat <= bbox[3]


def main():
    res_id = sys.argv[1] if len(sys.argv) > 1 else "22km"
    if res_id not in RESOLUTIONS:
        sys.exit(f"unknown resolution '{res_id}'. choices: {list(RESOLUTIONS)}")

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # Raw GeoPackage lives outside public/ so it is not copied into the static
    # export; generated GeoJSON is written into public/ for the app to fetch.
    src_dir = os.path.join(root, "data_src", f"res_{res_id}")
    data_dir = os.path.join(root, "public", "data", f"res_{res_id}")
    os.makedirs(data_dir, exist_ok=True)
    gpkg = os.path.join(src_dir, RESOLUTIONS[res_id])
    if not os.path.exists(gpkg):
        sys.exit(f"missing GeoPackage: {gpkg}")

    print(f"reading {gpkg}")
    con = sqlite3.connect(gpkg)
    cur = con.cursor()

    # round coordinates to 5 dp (~1 m) and population to ints to keep files small
    features = {slug: [] for slug in REGIONS}
    stats = {slug: {"count": 0, "population": 0.0} for slug in REGIONS}
    total_rows = 0

    for geom, h3, pop in cur.execute("SELECT geom, h3, population FROM population"):
        total_rows += 1
        if pop is None or pop <= 0:
            continue
        lng, lat = gpb_centroid(geom)
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [round(lng, 5), round(lat, 5)],
            },
            "properties": {"population": round(pop), "h3Index": h3},
        }
        for slug, cfg in REGIONS.items():
            if in_bbox(lng, lat, cfg["bbox"]):
                features[slug].append(feature)
                stats[slug]["count"] += 1
                stats[slug]["population"] += pop

    print(f"processed {total_rows} hexagons")

    manifest = {"resolutionId": res_id, "regions": []}
    for slug, cfg in REGIONS.items():
        fc = {"type": "FeatureCollection", "features": features[slug]}
        out_path = os.path.join(data_dir, f"{slug}.geojson")
        with open(out_path, "w") as f:
            json.dump(fc, f, separators=(",", ":"))
        size_mb = os.path.getsize(out_path) / 1e6
        print(
            f"  {slug:16s} {stats[slug]['count']:6d} nodes  "
            f"{stats[slug]['population']/1e6:8.1f}M pop  {size_mb:5.2f} MB"
        )
        manifest["regions"].append(
            {
                "slug": slug,
                "name": cfg["name"],
                "bbox": cfg["bbox"],
                "center": cfg["center"],
                "zoom": cfg["zoom"],
                "nodeCount": stats[slug]["count"],
            }
        )

    manifest_path = os.path.join(data_dir, "regions.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"wrote manifest {manifest_path}")


if __name__ == "__main__":
    main()
