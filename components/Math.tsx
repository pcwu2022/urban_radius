"use client";

import katex from "katex";
import "katex/dist/katex.min.css";

/** Inline LaTeX (e.g. within a sentence). */
export function MathInline({ tex }: { tex: string }) {
  const html = katex.renderToString(tex, { throwOnError: false, displayMode: false });
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Centered display-mode LaTeX (its own line). */
export function MathBlock({ tex }: { tex: string }) {
  const html = katex.renderToString(tex, { throwOnError: false, displayMode: true });
  return (
    <div
      className="my-1.5 overflow-x-auto text-slate-700"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
