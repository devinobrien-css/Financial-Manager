const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure better-sqlite3 (native module) stays server-side only
  serverExternalPackages: ['better-sqlite3'],
  // Produce a standalone output bundle for Docker
  output: 'standalone',
  // Pin workspace root to silence multi-lockfile warning
  turbopack: {
    root: path.resolve(__dirname),
  },
}

module.exports = nextConfig
