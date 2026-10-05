import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// npm run dev proxies /api and the shell websocket to the python server on :8750.
// npm run build writes dist/, which api/server.py serves.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8750", ws: true, changeOrigin: false },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("three") || id.includes("@react-three") || id.includes("postprocessing")) return "three";
          if (id.includes("@xterm")) return "xterm";
        },
      },
    },
  },
});
