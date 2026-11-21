import { baseConfig } from "@yuntera/next-kit/config";
import type { NextConfig } from "next";

// Shared security headers and build options: packages/next-kit/config.mjs.
// The internal console needs neither location nor camera, and tells search
// engines to stay out.
const nextConfig: NextConfig = {
  ...baseConfig({ internal: true }),
};

export default nextConfig;
