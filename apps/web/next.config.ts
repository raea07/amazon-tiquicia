import { baseConfig } from "@yuntera/next-kit/config";
import type { NextConfig } from "next";

// Security headers and build options are shared by every app: see
// packages/next-kit/config.mjs. The shop asks for location (to mark a
// delivery address) and never for the camera.
const nextConfig: NextConfig = {
  ...baseConfig({ geolocation: true }),
};

export default nextConfig;
