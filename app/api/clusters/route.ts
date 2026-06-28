import { computeClusters, isValidSlug } from "@/lib/serverData";
import type { Cluster, ClusterSSEEvent, WorkerOutput } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/clusters?region=<slug>&k=<number>&overlapFactor=<number>&minRadiusMult=<number>
 *
 * Streams Server-Sent Events (SSE) with intermediate merge-pass snapshots and a
 * final "done" event.  The frontend's EventSource reads progress events and updates
 * the map live; on "done" the computation is complete.
 *
 * Event shapes (ClusterSSEEvent):
 *   { type:"progress", pass:N, clusters:[...] }   — after each merge pass
 *   { type:"done",     clusters:[...], meta:{...} } — computation finished
 *   { type:"error",    message:"..." }              — error
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("region") ?? "";
  const k = Number(url.searchParams.get("k"));
  const overlapFactor = url.searchParams.has("overlapFactor")
    ? Number(url.searchParams.get("overlapFactor"))
    : 0.5;
  const minRadiusMult = url.searchParams.has("minRadiusMult")
    ? Number(url.searchParams.get("minRadiusMult"))
    : 1.0;

  if (!isValidSlug(slug)) {
    return new Response("data: " + JSON.stringify({ type: "error", message: "invalid region" } as ClusterSSEEvent) + "\n\n", {
      status: 400,
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  if (!Number.isFinite(k) || k <= 0) {
    return new Response("data: " + JSON.stringify({ type: "error", message: "invalid k" } as ClusterSSEEvent) + "\n\n", {
      status: 400,
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  if (!Number.isFinite(overlapFactor) || overlapFactor <= 0 || overlapFactor > 2) {
    return new Response("data: " + JSON.stringify({ type: "error", message: "invalid overlapFactor" } as ClusterSSEEvent) + "\n\n", {
      status: 400,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  // Derive minRadiusKm from the multiplier server-side using ACTIVE_CONFIG
  const { ACTIVE_CONFIG } = await import("@/lib/dataConfig");
  const minRadiusKm = ACTIVE_CONFIG.averageEdgeLengthKm * minRadiusMult;

  const precomputedFileName = `${slug}_k${k}_o${overlapFactor}_m${minRadiusMult}.json`;
  const precomputedFilePath = require("path").join(process.cwd(), "public", "data", "precomputed", precomputedFileName);
  let precomputedOut: WorkerOutput | null = null;
  
  if (require("fs").existsSync(precomputedFilePath)) {
    try {
      const fileData = require("fs").readFileSync(precomputedFilePath, "utf-8");
      precomputedOut = JSON.parse(fileData);
    } catch (e) {
      console.error("Failed to read precomputed file", e);
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(event: ClusterSSEEvent) {
        const line = "data: " + JSON.stringify(event) + "\n\n";
        controller.enqueue(encoder.encode(line));
      }

      // Keep-alive comment every 15s so proxies don't time out
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          // stream may already be closed
        }
      }, 15000);

      try {
        if (precomputedOut) {
          send({ type: "done", clusters: precomputedOut.clusters, meta: precomputedOut.meta });
        } else {
          // Progress callback: called by the algorithm before each merge pass
          const onProgress = (clusters: Cluster[], pass: number) => {
            send({ type: "progress", pass, clusters });
          };

          const out: WorkerOutput = computeClusters(slug, k, {
            overlapFactor,
            minRadiusKm,
            onProgress,
          });

          send({ type: "done", clusters: out.clusters, meta: out.meta });
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "computation failed",
        });
      } finally {
        clearInterval(keepAlive);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
}
