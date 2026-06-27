"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import { useStore } from "@/lib/store";

// MapLibre + the Web Worker touch `window`, so render the map client-only.
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">
      Loading map…
    </div>
  ),
});

export default function Page() {
  const init = useStore((s) => s.init);
  
  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <Header />
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 h-full">
          <MapView />
        </main>
        <Sidebar />
      </div>
    </div>
  );
}
