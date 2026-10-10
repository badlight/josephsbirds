import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  publicDir: false,
  // Catalogue and original photographs live in docs. Never clear them on build.
  build: { outDir: "docs", emptyOutDir: false }
});
