import { baseConfig } from "@yuntera/next-kit/config";
import type { NextConfig } from "next";

// Shared security headers and build options: packages/next-kit/config.mjs.
// The seller centre asks for location only to mark a pick-up point.
const nextConfig: NextConfig = {
  ...baseConfig({ geolocation: true, internal: true }),
};

export default nextConfig;
