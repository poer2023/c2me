import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Check if SSL certificates exist (only for local development)
const certPath = path.resolve(__dirname, "../.certs/localhost.key");
const hasCerts = fs.existsSync(certPath);

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    // HTTPS configuration for self-signed certificate (only if certs exist)
    https: hasCerts
      ? {
          key: fs.readFileSync(path.resolve(__dirname, "../.certs/localhost.key")),
          cert: fs.readFileSync(path.resolve(__dirname, "../.certs/localhost.crt")),
        }
      : undefined,
    hmr: host
      ? {
          protocol: hasCerts ? "wss" : "ws",  // Use wss only if HTTPS is enabled
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
