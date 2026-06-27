"use client";

import { useEffect, useState } from "react";

import { ACTIVE_CONFIG } from "@/lib/dataConfig";
import { formatKm, formatPop } from "@/lib/format";
import { K_MAX, K_MIN, useStore } from "@/lib/store";

export default function Sidebar() {
  const k = useStore((s) => s.k);
  const setK = useStore((s) => s.setK);
  const clusters = useStore((s) => s.clusters);
  const meta = useStore((s) => s.meta);
  const computeStatus = useStore((s) => s.computeStatus);
  const computeError = useStore((s) => s.computeError);
  const dataStatus = useStore((s) => s.dataStatus);
  const dataError = useStore((s) => s.dataError);
  const nodes = useStore((s) => s.nodes);

  // local "live" k value so dragging is smooth; commit to the store on release
  const [kDisplay, setKDisplay] = useState(k);
  useEffect(() => setKDisplay(k), [k]);

  const commit = () => {
    if (kDisplay !== k) setK(kDisplay);
  };

  const busy = computeStatus === "computing";

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white">
      {/* k control */}
      <section className="border-b border-slate-200 p-4">
        <div className="mb-1 flex items-baseline justify-between">
          <label htmlFor="k-slider" className="text-sm font-semibold text-slate-800">
            Tuning constant&nbsp;k
          </label>
          <span className="font-mono text-sm tabular-nums text-rose-600">
            {kDisplay.toFixed(0)}
          </span>
        </div>
        <input
          id="k-slider"
          type="range"
          min={K_MIN}
          max={K_MAX}
          step={1}
          value={kDisplay}
          disabled={dataStatus !== "ready"}
          onChange={(e) => setKDisplay(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          className="w-full accent-rose-600 disabled:opacity-50"
        />
        <div className="mt-1 flex justify-between text-[10px] text-slate-400">
          <span>{K_MIN} (large cities)</span>
          <span>{K_MAX} (tight cores)</span>
        </div>
        <p className="mt-2 text-xs leading-snug text-slate-500">
          k is the density threshold (people/km³). Lower k grows radii and merges
          metros; higher k shrinks them into dense cores. Release the slider to
          re-run the algorithm.
        </p>
      </section>

      {/* results */}
      <section className="flex-1 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">
            Detected cities{" "}
            <span className="text-slate-400">({clusters.length})</span>
          </h2>
          {busy && (
            <span className="animate-pulse text-xs text-rose-500">computing…</span>
          )}
        </div>

        {dataStatus === "error" && (
          <p className="text-xs text-red-600">Data error: {dataError}</p>
        )}
        {computeStatus === "error" && (
          <p className="text-xs text-red-600">Compute error: {computeError}</p>
        )}
        {dataStatus === "loading" && (
          <p className="text-xs text-slate-500">Loading region data…</p>
        )}

        <ol className="space-y-1.5">
          {clusters.map((c, i) => (
            <li
              key={c.id}
              className="rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700">
                  #{i + 1}
                  <span className="ml-1.5 font-mono text-slate-400">
                    {c.center.lat.toFixed(2)}, {c.center.lng.toFixed(2)}
                  </span>
                </span>
                <span className="font-mono text-rose-600">{formatKm(c.radiusKm)}</span>
              </div>
              <div className="mt-0.5 flex justify-between text-slate-500">
                <span>pop {formatPop(c.totalPopulation)}</span>
                <span>{c.memberNodeCount} hexes</span>
              </div>
            </li>
          ))}
        </ol>

        {clusters.length === 0 && dataStatus === "ready" && !busy && (
          <p className="text-xs text-slate-500">
            No cities at this k. Try lowering the slider.
          </p>
        )}
      </section>

      {/* resolution / info layer */}
      <section className="border-t border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        <h3 className="mb-1 font-semibold text-slate-700">Resolution</h3>
        <p>{ACTIVE_CONFIG.name}</p>
        <p>~{ACTIVE_CONFIG.averageEdgeLengthKm} km hexagon edge</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5">
          <dt>Nodes loaded</dt>
          <dd className="text-right font-mono text-slate-700">
            {nodes.length.toLocaleString()}
          </dd>
          <dt>Seeds</dt>
          <dd className="text-right font-mono text-slate-700">
            {meta?.seedCount ?? "–"}
          </dd>
          <dt>Compute time</dt>
          <dd className="text-right font-mono text-slate-700">
            {meta ? `${meta.executionTimeMs} ms` : "–"}
          </dd>
        </dl>
        <p className="mt-3 leading-snug text-slate-400">
          Cities are data-driven clusters, not administrative borders. R(c) is
          mathematically unique and the merge step is guaranteed to terminate;
          mean-shift convergence per seed is empirical, not guaranteed.
        </p>
      </section>
    </aside>
  );
}
