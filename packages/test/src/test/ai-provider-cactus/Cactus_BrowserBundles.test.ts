/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const cactusDist = resolve(testDir, "../../../../../providers/cactus/dist");
const browserBundles = ["ai.browser.js", "ai-runtime.browser.js"] as const;

describe("Cactus browser bundles", () => {
  it.each(browserBundles)("%s excludes the Node runtime", async (bundleName) => {
    const bundle = await readFile(resolve(cactusDist, bundleName), "utf8");

    expect(bundle).not.toContain("node:fs/promises");
    expect(bundle).not.toContain("node:path");
    expect(bundle).not.toContain("Cactus_Runtime.ts");
  });
});
