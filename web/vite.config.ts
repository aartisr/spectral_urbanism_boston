import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }
          if (id.includes("maplibre-gl")) {
            return "map";
          }
          return undefined;
        },
      },
    },
  },
  // Prefer TS/TSX when both generated JS and source TS files exist side-by-side.
  resolve: {
    dedupe: ["react", "react-dom"],
    extensions: [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".json"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
  },
});
