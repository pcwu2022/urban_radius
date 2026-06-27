/**
 * Web Worker entry point (spec.md Section 8).
 *
 * Runs the Urban Radius algorithm off the main thread so map pan/zoom stay smooth.
 * Each "run" request carries a requestId; the latest request always wins on the UI
 * side, so stale results from a superseded k value can be ignored.
 */

import { runAlgorithm } from "./algorithm";
import type { WorkerRequest, WorkerResponse } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = self as any;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (!msg || msg.type !== "run") return;
  try {
    const payload = runAlgorithm(msg.payload);
    const res: WorkerResponse = { type: "result", requestId: msg.requestId, payload };
    ctx.postMessage(res);
  } catch (err) {
    const res: WorkerResponse = {
      type: "error",
      requestId: msg.requestId,
      message: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(res);
  }
};
