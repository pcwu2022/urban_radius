"use client";

import { useStore } from "@/lib/store";

export default function Header() {
  const manifest = useStore((s) => s.manifest);
  const regionSlug = useStore((s) => s.regionSlug);
  const selectRegion = useStore((s) => s.selectRegion);
  const dataStatus = useStore((s) => s.dataStatus);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm">
      <div className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">
          Urban Radius Explorer
        </h1>
        <span className="hidden text-xs text-slate-500 sm:inline">
          data-driven cities from population density
        </span>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <span className="text-slate-500">Region</span>
        <select
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-800 outline-none focus:border-slate-500 disabled:opacity-50"
          value={regionSlug ?? ""}
          disabled={!manifest || dataStatus === "loading"}
          onChange={(e) => selectRegion(e.target.value)}
        >
          {!manifest && <option>Loading…</option>}
          {manifest?.regions.map((r) => (
            <option key={r.slug} value={r.slug}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
    </header>
  );
}
