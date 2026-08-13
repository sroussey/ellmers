/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listDirs, ROOT } from "./lib/testDiscovery";

/**
 * A `./test` entry is built by its own `bun build --packages=external` pass, so
 * anything it imports RELATIVELY gets inlined into that bundle. When the symbol
 * also exists in the package's main bundle, the result is two copies: two
 * registries, two class identities, an `instanceof` that fails and a reset hook
 * that clears a map nothing else reads.
 *
 * The rule is therefore: inside a test entry and its `testing/` sources, reach
 * anything the package itself owns by PACKAGE SPECIFIER. The one legitimate
 * relative import is a sibling under `testing/` — that code is unique to the
 * test bundle, so there is no second copy for it to diverge from.
 *
 * This has already gone wrong twice: `TestingLogger` was rewritten to
 * `../logging/*` while being moved into `util`, which inlined ConsoleLogger and
 * NullLogger; and the first draft of both identity tests compared a relative
 * source import against a package import resolving to `dist`.
 */

interface Offence {
  readonly file: string;
  readonly specifier: string;
}

/** Test-entry sources: `src/test*.ts` plus everything under `src/testing/`. */
function testEntrySources(pkgDir: string): string[] {
  const out: string[] = [];
  const src = join(pkgDir, "src");
  try {
    for (const f of readdirSync(src)) {
      if (/^test(-[a-z]+)?\.ts$|^test-entry\.ts$/.test(f)) out.push(join(src, f));
    }
  } catch {
    return out;
  }
  const testing = join(src, "testing");
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) {
        if (e !== "__tests__") walk(full);
      } else if (e.endsWith(".ts") && !e.includes(".test.")) out.push(full);
    }
  };
  walk(testing);
  return out;
}

/**
 * Strip comments so doc-comment examples are not mistaken for real imports.
 *
 * Line comments go FIRST. A line comment mentioning a glob such as
 * `../logging/*` contains `/*`, which — if block comments were stripped first —
 * opens a phantom block that swallows the real imports below it and makes this
 * check silently pass. That is not hypothetical: it is exactly how the comment
 * documenting this rule disabled the rule.
 */
function stripComments(src: string): string {
  return src.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("./test entry imports", () => {
  const offences: Offence[] = [];
  for (const group of ["packages", "providers"]) {
    for (const pkg of listDirs(join(ROOT, group))) {
      for (const file of testEntrySources(join(ROOT, group, pkg))) {
        const src = stripComments(readFileSync(file, "utf8"));
        for (const m of src.matchAll(/from\s*["'](\.[^"']+)["']/g)) {
          const spec = m[1];
          // A sibling under `testing/` is unique to this bundle — allowed.
          if (
            /^\.\/testing\//.test(spec) ||
            (file.includes("/src/testing/") && /^\.\//.test(spec))
          ) {
            continue;
          }
          offences.push({ file: file.replace(ROOT + "/", ""), specifier: spec });
        }
      }
    }
  }

  it("reaches package-owned symbols by package specifier, never relatively", () => {
    expect(offences).toEqual([]);
  });
});
