import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  root: "apps/web",
  plugins: [react(), tailwind()],
  build: { outDir: "../../dist", emptyOutDir: true },
  server: { allowedHosts: true },
  appType: "spa",
});
