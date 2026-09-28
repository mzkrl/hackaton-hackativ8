import type { NextConfig } from "next";

// The Cloudflare dev platform is not wired up here. Nothing in this app reads a
// binding (no `getCloudflareContext`, no `cloudflare:workers` import), so
// `setupDevPlatform()` from @cloudflare/next-on-pages only cost us a broken
// `next dev`.
//
// It used to be called from a top-level `await` below, which `next.config.ts`
// cannot run: Next loads this file as a plain Node module, not an ESM one, so
// `await` threw `ReferenceError: await is not defined` and every dev server
// exited with code 1. If Cloudflare bindings are ever needed, configure them
// from the function form of this config instead:
//
//   export default (phase, { defaultConfig }) => { ... }
//
// and run dev through the Cloudflare adapter, not plain `next dev`.
const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
