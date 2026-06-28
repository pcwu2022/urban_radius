"use client";

import { useEffect } from "react";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleEsc);
    }
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-lg transform overflow-hidden rounded-xl bg-white p-6 text-left align-middle shadow-2xl transition-all">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold leading-6 text-slate-800">
            About Urban Radius (R)
          </h3>
          <button
            type="button"
            className="rounded-md bg-white text-slate-400 hover:text-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
            onClick={onClose}
          >
            <span className="sr-only">Close</span>
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-2 text-sm text-slate-600 space-y-4">
          <p>
            Defining where a city's boundary ends and which surrounding places should be counted as the same city has always been a topic of debate.
          </p>
          <p>
            Thinking about this question, I was inspired by the <em>H-index</em> calculation method from academia, which states that an author has an H-index of <em>X</em> if they have <em>X</em> papers with at least <em>X</em> citations.
          </p>
          <p>
            Applying a similar logic geographically: if we assume a specific location is the center of a city, we can define a new spatial index—the <strong>Urban Radius "R"</strong>.
          </p>
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 text-slate-700 italic">
            <strong>R</strong> is the maximum radius <em>r</em> where the population density within <em>r</em> kilometers consistently exceeds <strong>k × r</strong> people per square kilometer (where <em>k</em> is a tuning constant).
          </div>
          <p>
            Therefore, by fixing the constant <em>k</em> across the globe, we can mathematically calculate and compare the true, data-driven boundaries of different cities by their <strong>R</strong> value—entirely independently of official administrative borders.
          </p>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            Created by <a href="https://pcwu2022.github.io" target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:text-sky-700 hover:underline">Po-Chun Wu</a>
          </div>
          <button
            type="button"
            className="inline-flex justify-center rounded-md border border-transparent bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 transition-colors"
            onClick={onClose}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
