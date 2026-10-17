import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verification URLs contain bearer tokens. Keep structured auth diagnostics,
  // but do not let the development request logger print their query strings.
  logging: { incomingRequests: { ignore: [/\/api\/auth\/verify-email(?:\?|$)/] } },
  experimental: {
    authInterrupts: true,
  },
  output: process.env.NEXT_STANDALONE === "true" ? "standalone" : undefined,
};

export default nextConfig;
