import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { selectNextBuild } from "./scripts/next-build-selection.cjs";
import { WORKER_RUNTIME } from "./scripts/worker-runtime.cjs";

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
  const config = { ...nextConfig, distDir: directory, env: { NEXT_PUBLIC_PHOENIX_RELEASE: directory, PHOENIX_WORKER_RUNTIME: WORKER_RUNTIME } };
  if (phase === PHASE_PRODUCTION_BUILD && process.platform === "win32" && process.env.PHOENIX_BUILD_DIR) {
    // Guarded builds use a fresh directory, so retaining the compiler cache adds memory without helping later builds.
    return {
      ...config,
      experimental: { ...config.experimental, webpackBuildWorker: true },
      webpack(webpackConfig) {
        webpackConfig.cache = false;
        return webpackConfig;
      },
    };
  }
  return config;
}
