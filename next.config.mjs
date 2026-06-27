/** @type {import('next').NextConfig} */

// Optional base path for hosting under a sub-path (e.g. "/urban-radius").
// Exposed to the client as NEXT_PUBLIC_BASE_PATH so asset/API URLs resolve.
const basePath = process.env.BASE_PATH || "";

const nextConfig = {
  // NOTE: no `output: 'export'`. The high-resolution grids are processed and the
  // Urban Radius algorithm is run on the server (API routes), so this app requires
  // a Node server (next start) and is not a static export.
  basePath: basePath || undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
