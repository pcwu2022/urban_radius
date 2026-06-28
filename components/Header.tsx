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
          redefining city boundaries using population density
        </span>
      </div>

      {/* Right side actions container */}
      <div className="flex items-center gap-4">
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

        {/* GitHub Link & Tooltip */}
        <div className="group relative flex items-center">
          <a
            href="https://github.com/pcwu2022/urban_radius"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
            aria-label="View on GitHub"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
              <path d="M9 18c-4.51 2-5-2-7-2" />
            </svg>
          </a>

          {/* Tooltip implementation */}
          <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
            View on GitHub
          </span>
        </div>
      </div>
    </header>
  );
}