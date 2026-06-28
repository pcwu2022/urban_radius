import fs from "fs";
import path from "path";

// In a real project with tsx, we can import these.
import { computeClusters } from "../lib/serverData";
import { ACTIVE_CONFIG } from "../lib/dataConfig";
import type { RegionsManifest } from "../lib/types";

const PRECOMPUTED_DIR = path.join(process.cwd(), "public/data/precomputed");
const REGIONS_FILE = path.join(process.cwd(), "public/data/res_3km/regions.json");

// The 4 param combinations requested:
// (100, 0.5, 1.0), (50, 0.5, 1.0), (100, 1.0, 1.0), (50, 1.0 ,1.0)
const PARAMS = [
  { k: 100, overlapFactor: 0.5, minRadiusMult: 1.0 },
  { k: 50, overlapFactor: 0.5, minRadiusMult: 1.0 },
  { k: 100, overlapFactor: 1.0, minRadiusMult: 1.0 },
  { k: 50, overlapFactor: 1.0, minRadiusMult: 1.0 },
];

function main() {
  if (!fs.existsSync(PRECOMPUTED_DIR)) {
    fs.mkdirSync(PRECOMPUTED_DIR, { recursive: true });
  }

  const manifestStr = fs.readFileSync(REGIONS_FILE, "utf-8");
  const manifest = JSON.parse(manifestStr) as RegionsManifest;

  let totalTime = 0;
  let count = 0;

  for (const region of manifest.regions) {
    for (const p of PARAMS) {
      const fileName = `${region.slug}_k${p.k}_o${p.overlapFactor}_m${p.minRadiusMult}.json`;
      const filePath = path.join(PRECOMPUTED_DIR, fileName);

      console.log(`\nComputing ${region.slug} with k=${p.k}, overlap=${p.overlapFactor}, mult=${p.minRadiusMult}...`);
      
      const start = Date.now();
      const minRadiusKm = ACTIVE_CONFIG.averageEdgeLengthKm * p.minRadiusMult;
      
      try {
        const out = computeClusters(region.slug, p.k, {
          overlapFactor: p.overlapFactor,
          minRadiusKm,
          onProgress: () => {}, // discard intermediate snapshots for precompute
        });
        
        fs.writeFileSync(filePath, JSON.stringify(out));
        
        const elapsed = Date.now() - start;
        totalTime += elapsed;
        count++;
        console.log(`✅ Saved ${fileName} (${out.clusters.length} clusters, ${elapsed}ms)`);
      } catch (err) {
        console.error(`❌ Failed to compute ${fileName}:`, err);
      }
    }
  }

  console.log(`\n🎉 Precomputed ${count} files in ${(totalTime / 1000).toFixed(2)}s.`);
}

main();
