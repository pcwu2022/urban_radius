import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Urban Radius Explorer",
  description:
    "Detect data-driven cities from global population density using the Urban Radius (R) algorithm.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-slate-100 text-slate-900">{children}</body>
    </html>
  );
}
