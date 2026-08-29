/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // apps/web is a workspace package (see root package.json "workspaces"),
  // so @tegata/schema resolves via the monorepo symlink — no transpilePackages
  // hack needed as long as it's installed from the repo root.

  // app/api/documents/prepare/route.ts reads assets/tegata-warrant.docx
  // via fs.readFile at request time. Next.js's file tracing usually
  // picks up static-looking fs calls automatically, but this path is
  // explicit insurance so a serverless deploy (Vercel etc.) doesn't
  // silently ship a function that 404s on its own template file.
  // Next 14.2.x: this option lives under `experimental` (it moved to
  // top-level stable in Next 15 — if this repo upgrades, move it too).
  experimental: {
    outputFileTracingIncludes: {
      "/api/documents/prepare/route": ["./assets/tegata-warrant.docx"],
    },
  },
};

module.exports = nextConfig;
