"use client";

import { useEffect, useState } from "react";

import { ACTIVE_CONFIG } from "@/lib/dataConfig";
import { formatKm, formatPop } from "@/lib/format";
import {
  K_MAX,
  K_MIN,
  OVERLAP_FACTOR_DEFAULT,
  OVERLAP_FACTOR_MAX,
  OVERLAP_FACTOR_MIN,
  MIN_RADIUS_MULT_DEFAULT,
  MIN_RADIUS_MULT_MAX,
  MIN_RADIUS_MULT_MIN,
  useStore,
} from "@/lib/store";
import { MathBlock, MathInline } from "@/components/Math";
import { AboutModal } from "@/components/AboutModal";
import type { Cluster } from "@/lib/types";

// The k slider is linear in position but logarithmic in k.
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

function CoverageBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const color =
    clamped >= 80 ? "bg-emerald-500" : clamped >= 50 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function ClusterCard({ cluster, rank }: { cluster: Cluster; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const setSelectedClusterId = useStore((s) => s.setSelectedClusterId);
  const mc = cluster.matchedCity;
  const coveragePct = mc ? (cluster.totalPopulation / mc.pop) * 100 : null;

  const handleExpand = () => {
    const newExpanded = !expanded;
    setExpanded(newExpanded);
    if (newExpanded) {
      setSelectedClusterId(cluster.id);
    }
  };

  return (
    <li className="rounded-lg border border-slate-100 bg-slate-50 text-xs overflow-hidden">
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={handleExpand}
        className="w-full px-2.5 py-1.5 text-left hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-medium text-slate-800">
            <span className="mr-1 text-slate-400">#{rank}</span>
            {cluster.name ? (
              cluster.name
            ) : (
              <span className="italic text-slate-400">Unnamed</span>
            )}
          </span>
          <span className="shrink-0 font-mono text-rose-600">
            {formatKm(cluster.radiusKm)}
          </span>
        </div>
        <div className="mt-0.5 flex justify-between font-mono text-[11px] text-slate-400">
          <span>
            {cluster.center.lat.toFixed(2)}, {cluster.center.lng.toFixed(2)}
          </span>
          <span>pop {formatPop(cluster.totalPopulation)}</span>
        </div>
      </button>

      {/* Expanded real-data panel */}
      {expanded && (
        <div className="border-t border-slate-100 px-2.5 py-2 space-y-2">
          {mc ? (
            <>
              {/* Real city position */}
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-sky-400 shrink-0" />
                <span className="font-semibold text-sky-700">
                  {mc.name}{" "}
                  <span className="font-normal text-slate-400">({mc.country})</span>
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                <dt className="text-slate-500">Real position</dt>
                <dd className="text-right font-mono text-slate-700">
                  {mc.lat.toFixed(2)}, {mc.lon.toFixed(2)}
                </dd>

                <dt className="text-slate-500">Real pop</dt>
                <dd className="text-right font-mono text-slate-700">
                  {formatPop(mc.pop)}
                </dd>

                <dt className="text-slate-500">Calc pop</dt>
                <dd className="text-right font-mono text-slate-700">
                  {formatPop(cluster.totalPopulation)}
                </dd>

                <dt className="text-slate-500">Coverage</dt>
                <dd className="text-right font-mono">
                  <span
                    className={
                      coveragePct! >= 80
                        ? "text-emerald-600"
                        : coveragePct! >= 50
                        ? "text-amber-600"
                        : "text-rose-600"
                    }
                  >
                    {coveragePct != null ? `${coveragePct.toFixed(0)}%` : "–"}
                  </span>
                </dd>
              </dl>

              {coveragePct != null && <CoverageBar pct={coveragePct} />}

              <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                <dt className="text-slate-500">Gazetteer rank</dt>
                <dd className="text-right font-mono text-slate-700">#{mc.rank}</dd>

                <dt className="text-slate-500">Algorithm rank</dt>
                <dd className="text-right font-mono text-slate-700">#{rank}</dd>

                {mc.rank !== rank && (
                  <>
                    <dt className="text-slate-500">Rank diff</dt>
                    <dd
                      className={`text-right font-mono ${
                        rank < mc.rank ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {rank < mc.rank
                        ? `▲ ${mc.rank - rank} higher`
                        : `▼ ${rank - mc.rank} lower`}
                    </dd>
                  </>
                )}
              </dl>
            </>
          ) : (
            <p className="text-slate-400 italic">
              No city match within the cluster radius.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export default function Sidebar() {
  const k = useStore((s) => s.k);
  const setK = useStore((s) => s.setK);
  const overlapFactor = useStore((s) => s.overlapFactor);
  const setOverlapFactor = useStore((s) => s.setOverlapFactor);
  const minRadiusMult = useStore((s) => s.minRadiusMult);
  const setMinRadiusMult = useStore((s) => s.setMinRadiusMult);
  const clusters = useStore((s) => s.clusters);
  const meta = useStore((s) => s.meta);
  const computeStatus = useStore((s) => s.computeStatus);
  const computeError = useStore((s) => s.computeError);
  const dataStatus = useStore((s) => s.dataStatus);
  const dataError = useStore((s) => s.dataError);
  const nodes = useStore((s) => s.nodes);
  const manifest = useStore((s) => s.manifest);
  const regionSlug = useStore((s) => s.regionSlug);
  const showRealCities = useStore((s) => s.showRealCities);
  const toggleRealCities = useStore((s) => s.toggleRealCities);
  const region =
    manifest && regionSlug
      ? manifest.regions.find((r) => r.slug === regionSlug) ?? null
      : null;

  // local "live" values so dragging is smooth; commit to the store on release
  const [kDisplay, setKDisplay] = useState(k);
  const [overlapDisplay, setOverlapDisplay] = useState(overlapFactor);
  const [multDisplay, setMultDisplay] = useState(minRadiusMult);

  useEffect(() => setKDisplay(k), [k]);
  useEffect(() => setOverlapDisplay(overlapFactor), [overlapFactor]);
  useEffect(() => setMultDisplay(minRadiusMult), [minRadiusMult]);

  const [showDetails, setShowDetails] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    const hasSeenAbout = localStorage.getItem("hasSeenAboutUrbanRadius");
    if (!hasSeenAbout) {
      setAboutOpen(true);
    }
  }, []);

  const handleCloseAbout = () => {
    setAboutOpen(false);
    localStorage.setItem("hasSeenAboutUrbanRadius", "true");
  };

  const commitK = () => { if (kDisplay !== k) setK(kDisplay); };
  const commitOverlap = () => { if (overlapDisplay !== overlapFactor) setOverlapFactor(overlapDisplay); };
  const commitMult = () => { if (multDisplay !== minRadiusMult) setMinRadiusMult(multDisplay); };

  const busy = computeStatus === "computing";
  const isReady = dataStatus === "ready";

  const minRadiusKmDisplay = (ACTIVE_CONFIG.averageEdgeLengthKm * multDisplay).toFixed(1);

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white">
      {/* ── Algorithm parameters ── */}
      <section className="border-b border-slate-200 p-4 space-y-4">

        {/* k slider */}
        <div>
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
            disabled={!isReady}
            onChange={(e) => setKDisplay(posToK(Number(e.target.value)))}
            onPointerUp={commitK}
            onKeyUp={commitK}
            className="w-full accent-rose-600 disabled:opacity-50"
          />
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>{K_MIN} (sprawling cities)</span>
            <span>{K_MAX} (dense urban cores)</span>
          </div>
          <p className="mt-2 text-xs leading-snug text-slate-500">
            Density threshold (people/km³). Lower k grows radii and merges
            metros; higher k shrinks them into dense cores. Release to re-run.
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
                <b>Merging.</b> Two clusters merge when their disks overlap,
              </p>
              <MathBlock tex="\operatorname{dist}(c_i,c_j) < (R_i + R_j)\cdot f," />
              <p>
                where <MathInline tex="f" /> is the merge overlap factor below.
              </p>
            </div>
          )}
        </div>

        {/* Overlap factor slider */}
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor="overlap-slider" className="text-sm font-semibold text-slate-800">
              Merge overlap factor
            </label>
            <span className="font-mono text-sm tabular-nums text-indigo-600">
              {overlapDisplay.toFixed(2)}
            </span>
          </div>
          <input
            id="overlap-slider"
            type="range"
            min={OVERLAP_FACTOR_MIN}
            max={OVERLAP_FACTOR_MAX}
            step={0.01}
            value={overlapDisplay}
            disabled={!isReady}
            onChange={(e) => setOverlapDisplay(Number(e.target.value))}
            onPointerUp={commitOverlap}
            onKeyUp={commitOverlap}
            className="w-full accent-indigo-600 disabled:opacity-50"
          />
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>0.5 (aggressive merge)</span>
            <span>1.0 (strict, no overlap)</span>
          </div>
          <p className="mt-1 text-xs leading-snug text-slate-500">
            At 0.5, clusters merge when they overlap by half their radius.
            At 1.0, only clusters whose edges touch merge.{" "}
            <span className="text-indigo-500">
              Default: {OVERLAP_FACTOR_DEFAULT}
            </span>
          </p>
        </div>

        {/* Min radius multiplier slider */}
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor="minradius-slider" className="text-sm font-semibold text-slate-800">
              Min radius multiplier
            </label>
            <span className="font-mono text-sm tabular-nums text-teal-600">
              {multDisplay.toFixed(1)}×
              <span className="ml-1 text-slate-400 text-xs">({minRadiusKmDisplay} km)</span>
            </span>
          </div>
          <input
            id="minradius-slider"
            type="range"
            min={MIN_RADIUS_MULT_MIN}
            max={MIN_RADIUS_MULT_MAX}
            step={0.1}
            value={multDisplay}
            disabled={!isReady}
            onChange={(e) => setMultDisplay(Number(e.target.value))}
            onPointerUp={commitMult}
            onKeyUp={commitMult}
            className="w-full accent-teal-600 disabled:opacity-50"
          />
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>{MIN_RADIUS_MULT_MIN}× hexagon edge</span>
            <span>{MIN_RADIUS_MULT_MAX}× hexagon edge</span>
          </div>
          <p className="mt-1 text-xs leading-snug text-slate-500">
            Minimum cluster radius as a multiple of the hexagon edge length (
            {ACTIVE_CONFIG.averageEdgeLengthKm} km). Smaller clusters are discarded.{" "}
            <span className="text-teal-500">
              Default: {MIN_RADIUS_MULT_DEFAULT}×
            </span>
          </p>
        </div>
      </section>

      {/* ── Results ── */}
      <section className="flex-1 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            Detected cities{" "}
            <span className="text-slate-400">({clusters.length})</span>
          </h2>
          <div className="flex items-center gap-2">
            {/* Real cities toggle */}
            <button
              type="button"
              id="toggle-real-cities"
              onClick={toggleRealCities}
              title={showRealCities ? "Hide real city positions" : "Show real city positions"}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors border ${
                showRealCities
                  ? "bg-sky-100 text-sky-700 border-sky-300"
                  : "bg-slate-100 text-slate-500 border-slate-200"
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-sky-400 inline-block" />
              Real cities
            </button>

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

        {/* Legend */}
        {clusters.length > 0 && (
          <div className="mb-2 flex items-center gap-3 text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-rose-500 inline-block" />
              Calculated center
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-sky-400 inline-block" />
              Real city location
            </span>
          </div>
        )}

        <p className="mb-2 text-[10px] text-slate-400 italic">
          Click a city to expand real-world data ↓
        </p>

        <ol className="space-y-1.5">
          {clusters.map((c, i) => (
            <ClusterCard key={c.id} cluster={c} rank={i + 1} />
          ))}
        </ol>

        {clusters.length === 0 && dataStatus === "ready" && !busy && (
          <p className="text-xs text-slate-500">
            No cities at this k. Try lowering the slider.
          </p>
        )}
      </section>

      {/* ── Resolution / info layer ── */}
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
          Shows the densest {nodes.length.toLocaleString()} points for context.
          Cities are data-driven clusters, not administrative borders.
        </p>
        <button
          onClick={() => setAboutOpen(true)}
          className="mt-3 flex items-center gap-1.5 text-slate-500 hover:text-slate-700 transition-colors"
        >
          <span className="text-sm">ℹ️</span>
          <span className="underline decoration-slate-300 underline-offset-2">About Urban Radius (R)</span>
        </button>
      </section>

      <AboutModal isOpen={aboutOpen} onClose={handleCloseAbout} />
    </aside>
  );
}
