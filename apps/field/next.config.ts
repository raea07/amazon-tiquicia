import { baseConfig } from "@yuntera/next-kit/config";
import type { NextConfig } from "next";

// Shared security headers and build options: packages/next-kit/config.mjs.
// Drivers share their position while a route is open; nothing uses the camera.
const nextConfig: NextConfig = {
  ...baseConfig({ app: "field", geolocation: true, internal: true }),
};

export default nextConfig;
