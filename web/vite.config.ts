import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies Patch Data API calls so the browser makes same-origin
// requests (no CORS). Start the API alongside it: `cd api && npm run dev`.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/patches": "http://127.0.0.1:3000",
      "/sims": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000",
    },
  },
});
