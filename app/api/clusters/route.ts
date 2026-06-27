import { NextResponse } from "next/server";

import { computeClusters, isValidSlug } from "@/lib/serverData";

export const dynamic = "force-dynamic";

/**
 * GET /api/clusters?region=<slug>&k=<number>
 * Runs the Urban Radius algorithm server-side on the region's full node set and
 * returns the detected cities (WorkerOutput shape). Results are cached per (region, k).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("region") ?? "";
  const k = Number(url.searchParams.get("k"));

  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: "invalid region" }, { status: 400 });
  }
  if (!Number.isFinite(k) || k <= 0) {
    return NextResponse.json({ error: "invalid k" }, { status: 400 });
  }

  try {
    const out = computeClusters(slug, k);
    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "computation failed" },
      { status: 500 }
    );
  }
}
