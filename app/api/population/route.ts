import { NextResponse } from "next/server";

import { isValidSlug, regionDisplayNodes } from "@/lib/serverData";

// Reads query params + the filesystem, so it must run per-request (not prerendered).
export const dynamic = "force-dynamic";

/**
 * GET /api/population?region=<slug>
 * Returns a bounded, downsampled set of population points for the dots layer.
 */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("region") ?? "";
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: "invalid region" }, { status: 400 });
  }
  try {
    const { nodes, totalNodeCount } = regionDisplayNodes(slug);
    return NextResponse.json(
      { nodes, totalNodeCount, displayedNodeCount: nodes.length },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to load region" },
      { status: 404 }
    );
  }
}
