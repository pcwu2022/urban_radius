/** @type {import('next').NextConfig} */

// Set BASE_PATH (e.g. "/urban-radius") when deploying to a project GitHub Pages URL.
// It is exposed to the client as NEXT_PUBLIC_BASE_PATH so static asset fetches resolve.
const basePath = process.env.BASE_PATH || "";

const nextConfig = {
  // Fully static export: produces ./out with no Node server, so it can be hosted on
  // GitHub Pages. All computation happens client-side (Web Worker); no API routes.
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  basePath: basePath || undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  webpack: (config) => {
    // Allow web workers (globalObject 'self' for worker bundles).
    config.output.globalObject = "self";
    return config;
  },
};

export default nextConfig;
