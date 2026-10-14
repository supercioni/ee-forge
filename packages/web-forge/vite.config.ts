import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // The dev server forwards `/forge/*` to whatever Forge service is running:
  // Forge's own server by default, or the EXODUS bridge via FORGE_API_URL.
  // Same-origin in the browser, so nothing in the app names a host or port.
  const env = loadEnv(mode, process.cwd(), "");
  const api = env["FORGE_API_URL"] ?? "http://127.0.0.1:8092";
  return {
    plugins: [react()],
    server: {
      // 5173 = web-cockpit, 5174 = web-viewer, 5175 = web-codex,
      // 5176 = this editor. strictPort so a collision fails loud instead
      // of silently falling back to a random port.
      port: 5176,
      strictPort: true,
      host: "0.0.0.0",
      proxy: { "/forge": { target: api, changeOrigin: true } },
    },
    preview: { port: 5176, strictPort: true, proxy: { "/forge": { target: api, changeOrigin: true } } },
  };
});
