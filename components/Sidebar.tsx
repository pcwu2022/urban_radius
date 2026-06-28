"use client";

import { useEffect, useState } from "react";

import { ACTIVE_CONFIG } from "@/lib/dataConfig";
import { formatKm, formatPop } from "@/lib/format";
import { K_MAX, K_MIN, useStore } from "@/lib/store";
import { MathBlock, MathInline } from "@/components/Math";

// The slider is linear in position but logarithmic in k, since k's effect spans
// orders of magnitude. Position runs 0..SLIDER_STEPS and maps to [K_MIN, K_MAX].
const SLIDER_STEPS = 1000;
const LOG_MIN = Math.log10(K_MIN);
const LOG_MAX = Math.log10(K_MAX);

function posToK(pos: number): number {
  return Math.pow(10, LOG_MIN + (pos / SLIDER_STEPS) * (LOG_MAX - LOG_MIN));
}
function kToPos(k: number): number {
  const clamped = Math.max(K_MIN, Math.min(K_MAX, k));
  return ((Math.log10(clamped) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * SLIDER_STEPS;
}
function formatK(k: number): string {
  if (k >= 10) return k.toFixed(0);
  if (k >= 1) return k.toFixed(1);
  if (k >= 0.1) return k.toFixed(2);
  return k.toFixed(3);
}

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
  const manifest = useStore((s) => s.manifest);
  const regionSlug = useStore((s) => s.regionSlug);
  const region =
    manifest && regionSlug
      ? manifest.regions.find((r) => r.slug === regionSlug) ?? null
      : null;

  // local "live" k value so dragging is smooth; commit to the store on release
  const [kDisplay, setKDisplay] = useState(k);
  useEffect(() => setKDisplay(k), [k]);

  const [showDetails, setShowDetails] = useState(false);

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
            {formatK(kDisplay)}
          </span>
        </div>
        <input
          id="k-slider"
          type="range"
          min={0}
          max={SLIDER_STEPS}
          step={1}
          value={kToPos(kDisplay)}
          disabled={dataStatus !== "ready"}
          onChange={(e) => setKDisplay(posToK(Number(e.target.value)))}
          onPointerUp={commit}
          onKeyUp={commit}
          className="w-full accent-rose-600 disabled:opacity-50"
        />
        <div className="mt-1 flex justify-between text-[10px] text-slate-400">
          <span>{K_MIN} (sprawling cities)</span>
          <span>{K_MAX} (dense urban cores)</span>
        </div>
        <p className="mt-2 text-xs leading-snug text-slate-500">
          k is the density threshold (people/km³). Lower k grows radii and merges
          metros; higher k shrinks them into dense cores. Release the slider to
          re-run the algorithm.
        </p>

        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="mt-2 flex items-center gap-1 text-xs font-medium text-rose-600 hover:text-rose-700"
          aria-expanded={showDetails}
        >
          <span className={`transition-transform ${showDetails ? "rotate-90" : ""}`}>
            ▶
          </span>
          {showDetails ? "Hide" : "How the index is computed"}
        </button>

        {showDetails && (
          <div className="mt-2 space-y-2 rounded-md bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            <p>
              For a candidate centre <MathInline tex="c" /> and radius{" "}
              <MathInline tex="r" />, let <MathInline tex="P(r,c)" /> be the total
              population within distance <MathInline tex="r" />. The{" "}
              <b>cumulative density</b> is
            </p>
            <MathBlock tex="\rho(r,c) = \dfrac{P(r,c)}{\pi r^2}\quad[\text{people}/\text{km}^2]." />
            <p>
              The <b>Urban Radius</b> <MathInline tex="R(c)" /> is the largest{" "}
              <MathInline tex="r" /> for which density stays above the linear
              threshold <MathInline tex="k\,r" /> everywhere up to it:
            </p>
            <MathBlock tex="R(c) = \sup\{\, r : \rho(r',c) > k\,r'\ \ \forall\, r' \le r \,\}." />
            <p>
              Since <MathInline tex="\rho" /> is non-increasing and{" "}
              <MathInline tex="k r" /> increases, the difference{" "}
              <MathInline tex="\rho(r,c)-k r" /> crosses zero at most once, so{" "}
              <MathInline tex="R(c)" /> is unique. At the crossing the contained
              population <MathInline tex="P" /> satisfies{" "}
              <MathInline tex="P/(\pi R^2)=kR" />, i.e.
            </p>
            <MathBlock tex="R(c) = \left(\dfrac{P}{\pi k}\right)^{1/3}." />
            <p>
              <b>Finding centres (mean-shift).</b> From each seed we iterate toward
              the population-weighted centroid of the nodes inside{" "}
              <MathInline tex="R(c)" />, with damping{" "}
              <MathInline tex="0<\alpha\le 1" />:
            </p>
            <MathBlock tex="c_{t+1} = c_t + \alpha\,\big(\bar c_{R(c_t)} - c_t\big)," />
            <p>
              where{" "}
              <MathInline tex="\bar c_{R} = \dfrac{\sum_i p_i\,x_i}{\sum_i p_i}" />{" "}
              over member nodes <MathInline tex="i" />. The bandwidth{" "}
              <MathInline tex="R" /> is recomputed every step, so the search is
              self-tuning. Iteration stops when the centre moves less than{" "}
              <MathInline tex="\varepsilon" />.
            </p>
            <p>
              <b>Seeding.</b> One seed per local population maximum (highest node in
              its grid neighbourhood), so results are deterministic.
            </p>
            <p>
              <b>Merging.</b> Two clusters merge when their disks overlap,
            </p>
            <MathBlock tex="\operatorname{dist}(c_i,c_j) < R_i + R_j," />
            <p>
              applied transitively (connected components) and repeated until a pass
              makes no merges — guaranteed to terminate as the cluster count strictly
              decreases. Finally, clusters with{" "}
              <MathInline tex="R < 1\,\text{km}" /> are dropped.
            </p>
          </div>
        )}
      </section>

      {/* results */}
      <section className="flex-1 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">
            Detected cities{" "}
            <span className="text-slate-400">({clusters.length})</span>
          </h2>
          {busy && (
            <span className="flex items-center gap-1.5 rounded-full bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
              <span
                className="h-3 w-3 animate-spin rounded-full border-2 border-rose-200 border-t-white"
                aria-hidden
              />
              {dataStatus === "loading" ? "Loading…" : "Computing…"}
            </span>
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
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-slate-800">
                  <span className="mr-1 text-slate-400">#{i + 1}</span>
                  {c.name ? (
                    c.name
                  ) : (
                    <span className="italic text-slate-400">Unnamed</span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-rose-600">
                  {formatKm(c.radiusKm)}
                </span>
              </div>
              <div className="mt-0.5 flex justify-between font-mono text-[11px] text-slate-400">
                <span>{c.center.lat.toFixed(2)}, {c.center.lng.toFixed(2)}</span>
                <span>pop {formatPop(c.totalPopulation)}</span>
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
          <dt>Region nodes</dt>
          <dd className="text-right font-mono text-slate-700">
            {region ? region.nodeCount.toLocaleString() : "–"}
          </dd>
          <dt>Points shown</dt>
          <dd className="text-right font-mono text-slate-700">
            {nodes.length.toLocaleString()}
          </dd>
          <dt>Seeds</dt>
          <dd className="text-right font-mono text-slate-700">
            {meta?.seedCount ?? "–"}
          </dd>
          <dt>Server compute</dt>
          <dd className="text-right font-mono text-slate-700">
            {meta ? `${meta.executionTimeMs} ms` : "–"}
          </dd>
        </dl>
        <p className="mt-3 leading-snug text-slate-400">
          Data processing and clustering run server-side on the full grid; the map
          shows the densest {nodes.length.toLocaleString()} points for context.
          Cities are data-driven clusters, not administrative borders.
        </p>
      </section>
    </aside>
  );
}
