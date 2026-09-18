import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Packages that spawn worker_threads pointing at their own compiled
  // files by relative path -- webpack bundling those files under
  // .next/server/vendor-chunks/ breaks the path the Worker actually loads
  // at runtime ("Cannot find module .../vendor-chunks/lib/worker.js").
  // Confirmed live: this crashed the whole dev server on the first sign-in
  // attempt -- traced to pino-pretty's transport (via thread-stream), not
  // argon2 as first suspected; excluding all three (argon2 uses the same
  // worker-thread pattern for hashing) rather than re-discovering this one
  // package at a time. Excluding them from bundling and requiring them
  // natively via Node at runtime is the standard fix.
  serverExternalPackages: ["argon2", "pino", "pino-pretty", "thread-stream"],
  // Product images are imported verbatim from AliExpress (lib/catalog/import.ts),
  // served from whichever of their many CDN subdomains the listing used.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.alicdn.com" }],
  },
};

export default nextConfig;
