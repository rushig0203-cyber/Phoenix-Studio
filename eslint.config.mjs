import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@next/next/no-img-element": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/immutability": "off",
      "@typescript-eslint/no-require-imports": "off"
    }
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-lumina/**",
    "out/**",
    "build/**",
    "storage/**",
    "work/**",
    "next-env.d.ts",
    "public/ffmpeg.js",
    "public/814.ffmpeg.js",
    "scratch_query.js"
  ]),
]);

export default eslintConfig;
