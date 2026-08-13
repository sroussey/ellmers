import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

const analyze = process.env.ANALYZE === "1";

// Bundle report: `stats.html` is written to dist/ only during `vite build` (see analyze script).
// `vite dev` does not serve dist — after analyze, run `bun run analyze:preview` and open /stats.html
// or open dist/stats.html directly in a browser.

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    wasm(),
    analyze &&
      visualizer({
        filename: "dist/stats.html",
        gzipSize: true,
        brotliSize: true,
        open: false,
        template: "treemap",
        title: "@workglow/web bundle",
      }),
  ].filter(Boolean),
  resolve: {
    mainFields: ["browser", "import", "module", "main"],
    // Bun's isolated linker can leave multiple @codemirror / @lezer copies in
    // the graph; CodeMirror + HighlightStyle use instanceof / shared Tag
    // identity and break when mixed ("tags is not iterable").
    dedupe: [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/commands",
      "@codemirror/autocomplete",
      "@codemirror/lint",
      "@codemirror/search",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
    ],
  },  build: {
    target: "esnext",
    rolldownOptions: {
      output: {
        codeSplitting: {
          minSize: 50_000,
          groups: [
            {
              name: "react",
              priority: 20,
              test: /node_modules[\\/](?:react(?:-dom)?[\\/]|@xyflow[\\/]react|react-resizable-panels)/,
            },
            {
              name: "mediapipe",
              priority: 18,
              test: /node_modules[\\/]@mediapipe[\\/]/,
            },
            {
              name: "codemirror",
              priority: 17,
              test: /node_modules[\\/](?:@codemirror|@lezer|@uiw[\\/]|style-mod|crelt|w3c-keyname)/,
            },
            {
              name: "huggingface",
              priority: 16,
              test: /node_modules[\\/]@huggingface[\\/]/,
              maxSize: 400_000,
            },
            {
              name: "workglow",
              priority: 15,
              test: /node_modules[\\/]@workglow[\\/]/,
              entriesAware: true,
              maxSize: 400_000,
            },
            {
              name: "icons",
              priority: 12,
              test: /node_modules[\\/](?:react-icons|@radix-ui[\\/]react-icons)/,
            },
            {
              name: "vendor",
              priority: 10,
              test: /node_modules[\\/]/,
            },
          ],
        },
      },
    },
  },
  worker: {
    format: "es",
    plugins: () => [wasm()],
    // rolldownOptions: {
    //   output: {
    //     codeSplitting: {
    //       minSize: 20_000,
    //       groups: [
    //         {
    //           name: "hf-transformers",
    //           priority: 16,
    //           test: /node_modules[\\/]@huggingface[\\/]/,
    //           maxSize: 400_000,
    //         },
    //         {
    //           name: "workglow",
    //           priority: 15,
    //           test: /node_modules[\\/]@workglow[\\/]/,
    //           maxSize: 400_000,
    //         },
    //         {
    //           name: "vendor",
    //           priority: 10,
    //           test: /node_modules[\\/]/,
    //         },
    //       ],
    //     },
    //   },
    // },
  },
  optimizeDeps: {
    exclude: ["tiktoken", "@huggingface/transformers"],
    // Direct @codemirror/{state,view,language} deps + resolve.dedupe keep a
    // single copy; do not list them in `include` — Vite fails to resolve them
    // here under Bun's isolated linker even though app imports work.
    include: [
      "@codemirror/lang-json",
      "@uiw/react-codemirror",
      "@uiw/codemirror-theme-vscode",
    ],
  },
});
