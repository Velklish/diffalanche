import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** The UI is built into `dist/ui`; the server serves that directory. */
export default defineConfig({
  root: "src/ui",
  plugins: [react()],
  build: {
    outDir: "../../dist/ui",
    emptyOutDir: true,
  },
});
