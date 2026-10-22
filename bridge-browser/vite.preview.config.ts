import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Standalone config for the UI preview harness.
 *
 * Kept separate from vite.config.ts so the extension build (CRXJS) never
 * picks up the preview entry, and the preview can resolve @webcode/shared
 * without the dev-time inlining plugin.
 */
export default defineConfig({
  root: resolve(__dirname, "preview"),
  server: { port: 5174, strictPort: true },
  build: {
    outDir: resolve(__dirname, "preview-dist"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@webcode/shared": resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});
