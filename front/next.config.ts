import type { NextConfig } from "next";
import { setupDevPlatform } from "@cloudflare/next-on-pages/next-dev";

// Setup Cloudflare bindings for local development
if (process.env.NODE_ENV === "development") {
  await setupDevPlatform();
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
