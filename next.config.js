/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure better-sqlite3 (native module) stays server-side only
  serverExternalPackages: ['better-sqlite3'],
}

module.exports = nextConfig
