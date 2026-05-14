import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  envDir: __dirname,
  test: {
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 15000, // 15 second global timeout (WASM Postgres / PGlite init can be slow)
    // Vitest uses hookTimeout for beforeEach/afterAll separately from testTimeout; keep both aligned
    hookTimeout: 15000,
    retry: 1,
    exclude: [...configDefaults.exclude, "**/*.e2e.test.ts"],
    coverage: {
      provider: "v8", // or 'istanbul'
      reporter: ["text", "json", "json-summary", "html"],
      exclude: [...configDefaults.exclude, "packages/test/**"],
    },
  },
});
