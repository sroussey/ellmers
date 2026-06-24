import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  envDir: __dirname,
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // The nightly type-drift guard runs `.test-d.ts` files through vitest's
    // `--typecheck` engine. Scope the tsc program to the package under test so
    // unrelated source (example UIs needing `jsx`, providers relying on their
    // own ambient `types`/`lib`) is not swept in and reported as drift.
    typecheck: {
      tsconfig: "./tsconfig.typecheck.json",
    },
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
