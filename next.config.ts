import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A temporary build directory lets us verify an update without rewriting a live build.
  distDir: process.env.PHOENIX_BUILD_DIR || ".next-lumina",
  experimental: {
    cpus: 1,
    webpackMemoryOptimizations: true,
  },
  // Runtime uploads and renders can be several gigabytes. They are data, not
  // application dependencies, so tracing them during `next build` wastes RAM
  // and can make Windows fail with resource error 1450.
  outputFileTracingExcludes: {
    "*": ["./storage/**/*", "./work/**/*", "./public/local-videos/**/*"],
  },
  async headers() {
    return [
      {
        source: "/dashboard/project/:id*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
