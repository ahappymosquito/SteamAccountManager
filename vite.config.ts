// Vite build and test configuration for the desktop webview.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()], clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: { target: "chrome105", minify: "oxc", sourcemap: true },
  test: { environment: "jsdom", setupFiles: "./src/test/setup.ts", css: true }
});
