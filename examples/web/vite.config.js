import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  esbuild: {
    target: "esnext",
  },
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: {
          "huggingface-transformers": ["@huggingface/transformers"],
          "tf-mediapipe": ["@mediapipe/tasks-text"],
          react: [
            "react",
            "react-dom",
            "@xyflow/react",
            "react-hotkeys-hook",
            "react-icons",
            "react-resizable-panels",
          ],
        },
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
    },
  },
});
