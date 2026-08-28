/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // apps/web is a workspace package (see root package.json "workspaces"),
  // so @tegata/schema resolves via the monorepo symlink — no transpilePackages
  // hack needed as long as it's installed from the repo root.
};

module.exports = nextConfig;
