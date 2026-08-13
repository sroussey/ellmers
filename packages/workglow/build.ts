/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Custom build script for the workglow meta-package.
 *
 * We cannot use `bun build --packages=external` here because bun's bundler
 * generates broken re-export code for `export * from "<external>"` — the
 * emitted `__reExport(target, varname)` calls reference variables that are
 * never bound to the bare `import "..."` statements.
 *
 * Instead, we transpile each .ts source file individually using Bun.Transpiler,
 * which correctly preserves `export *` pass-throughs as plain ESM.
 */

import { Glob } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertNoExportCollisions } from "./detect-export-collisions";

const srcDir = join(import.meta.dir, "src");
const distDir = join(import.meta.dir, "dist");

const barrelPaths = ["common.ts", "browser.ts", "node.ts"]
  .map((name) => join(srcDir, name))
  .filter((path) => existsSync(path));
await assertNoExportCollisions(barrelPaths);

const transpiler = new Bun.Transpiler({ loader: "ts" });

const glob = new Glob("*.ts");
for await (const file of glob.scan(srcDir)) {
  const srcPath = join(srcDir, file);
  const outName = file.replace(/\.ts$/, ".js");
  const outPath = join(distDir, outName);

  const source = await Bun.file(srcPath).text();
  const js = transpiler.transformSync(source);
  await Bun.write(outPath, js);
}
