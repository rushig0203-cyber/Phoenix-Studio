import type { NextConfig } from "next";
import { selectNextBuild } from "./scripts/next-build-selection.cjs";

const nextConfig: NextConfig = {
  experimental: {
    cpus: 1,
    webpackMemoryOptimizations: true,
    // Load page modules when requested instead of loading every entry at startup.
    preloadEntriesOnStart: false,
  },
  // Runtime uploads and renders can be several gigabytes. They are data, not
  // application dependencies, so tracing them during `next build` wastes RAM
  // and can make Windows fail with resource error 1450.
  outputFileTracingExcludes: {
    "*": ["./storage/**/*", "./work/**/*", "./public/local-videos/**/*"],
  },
};

export default function configureNext(phase: string): NextConfig {
  const directory = selectNextBuild(phase);
  return { ...nextConfig, distDir: directory, env: { NEXT_PUBLIC_PHOENIX_RELEASE: directory } };
}
