import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Local dev: /api is proxied to the Functions emulator
// (http://127.0.0.1:5001/<project-id>/asia-south1/api).
// Production (Netlify): set VITE_API_URL to the deployed Functions URL.
const PROJECT = process.env.VITE_FIREBASE_PROJECT_ID || "demo-ationic";

export default defineConfig(({ mode }) => {
  loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:5001",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, `/${PROJECT}/asia-south1/api`),
        },
      },
    },
    build: { outDir: "dist", sourcemap: false },
  };
});
