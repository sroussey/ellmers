/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Every name a provider's BROWSER bundle imports from `@workglow/storage` must
 * exist in that package's BROWSER entry.
 *
 * Nothing else checks this. `bun build --packages=external` leaves
 * `@workglow/storage` as a bare import and never resolves it, so a provider can
 * import a server-only symbol and still build clean; Vitest then runs under
 * Node, where the same specifier resolves to the node entry and the symbol is
 * there. The mismatch surfaces only when a consumer bundles for a real browser
 * — which is the whole point of the PGlite and WASM-SQLite backends.
 *
 * This is not hypothetical: the connection-transaction work added
 * `enqueueDeferredPut`, `runNativeConnectionTransaction` and friends to all
 * three tabular storages while exporting them only from the server entry.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

const PROVIDER_BROWSER_ENTRIES = [
  ["@workglow/sqlite", "providers/sqlite/src/storage/browser.ts"],
  ["@workglow/postgres", "providers/postgres/src/storage/browser.ts"],
  ["@workglow/duckdb", "providers/duckdb/src/storage/browser.ts"],
] as const;

/** Named imports a bundle takes from `@workglow/storage`, in source order. */
function storageImportsOf(bundle: string): string[] {
  const names: string[] = [];
  const pattern = /import\s*\{([^}]*)\}\s*from\s*"@workglow\/storage"/g;
  for (const match of bundle.matchAll(pattern)) {
    for (const raw of match[1]!.split(",")) {
      const name = raw
        .trim()
        .split(/\s+as\s+/)[0]!
        .trim();
      if (name.length > 0) names.push(name);
    }
  }
  return names;
}

// Requires `bun build`; skipped under the vitest/Node runner where `Bun` is undefined.
describe.skipIf(typeof Bun === "undefined")("provider browser bundles", () => {
  let outDir: string;
  let storageBrowserExports: Set<string>;

  async function build(entry: string, subdir: string): Promise<string> {
    const dir = path.join(outDir, subdir);
    const proc = Bun.spawn(
      [
        "bun",
        "build",
        "--target=browser",
        "--packages=external",
        `--outdir=${dir}`,
        path.join(repoRoot, entry),
      ],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode, `build of ${entry} failed:\n${stdout}\n${stderr}`).toBe(0);
    return readFile(path.join(dir, "browser.js"), "utf8");
  }

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), "provider-browser-"));
    // Import the browser entry the way a browser bundler resolves it, and take
    // the export surface from the module itself rather than parsing the bundle.
    const mod: Record<string, unknown> = await import(
      path.join(repoRoot, "packages/storage/src/browser.ts")
    );
    storageBrowserExports = new Set(Object.keys(mod));
  }, 120_000);

  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  it.each(PROVIDER_BROWSER_ENTRIES)(
    "%s imports only names @workglow/storage's browser entry exports",
    async (_name, entry) => {
      const bundle = await build(entry, entry.split("/")[1]!);
      const imported = storageImportsOf(bundle);
      // A bundle that imports nothing would pass vacuously; these all do.
      expect(imported.length).toBeGreaterThan(0);
      const missing = [...new Set(imported)].filter((n) => !storageBrowserExports.has(n)).sort();
      expect(missing).toEqual([]);
    },
    120_000
  );
});
