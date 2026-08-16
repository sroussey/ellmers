/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { filesInChangedPackages, isRepoWideTestChange } from "./lib/changedPackages";
import { ROOT, type TestFile } from "./lib/testDiscovery";

function file(rel: string, section: string): TestFile {
  return { path: `${ROOT}/${rel}`, section, runner: "any" };
}

describe("changedPackages", () => {
  it("keeps files whose project dir is in the changed set and drops the rest", () => {
    const selected = filesInChangedPackages(
      [
        file("packages/util/src/foo.test.ts", "util"),
        file("packages/storage/src/bar.test.ts", "storage"),
        file("scripts/test.test.ts", "scripts"),
      ],
      new Set(["packages/util", "scripts"])
    );
    expect(selected.map((f) => f.section).sort()).toEqual(["scripts", "util"]);
  });

  it("treats a root lockfile or vitest config change as repo-wide", () => {
    expect(isRepoWideTestChange(["packages/util/src/foo.ts"])).toBe(false);
    expect(isRepoWideTestChange(["bun.lock"])).toBe(true);
    expect(isRepoWideTestChange(["vitest.config.ts", "packages/util/src/foo.ts"])).toBe(true);
  });
});
