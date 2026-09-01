/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PackageJson {
  readonly scripts: Record<string, string>;
  readonly files: readonly string[];
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

function packageJson(): PackageJson {
  return JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as PackageJson;
}

describe("web client packaging", () => {
  it("keeps the client build in build-example, so a published tarball has one", () => {
    const pkg = packageJson();
    expect(pkg.scripts["build-web"]).toBeDefined();
    expect(pkg.scripts["build-example"]).toContain("build-web");
    expect(pkg.files).toContain("dist");
  });

  it("bundles preact rather than depending on it at runtime", () => {
    const pkg = packageJson();
    expect(pkg.dependencies?.preact).toBeUndefined();
    expect(pkg.devDependencies?.preact).toBeDefined();
  });

  it("keeps the console's boot independent of a font CDN", () => {
    // A deferred module script waits on pending stylesheets, so a blocking
    // font link means no console at all on a machine that cannot reach it.
    const html = readFileSync(new URL("./client/index.html", import.meta.url), "utf8");
    const fontLink = /<link[^>]*fonts\.googleapis\.com[^>]*>/.exec(html)?.[0] ?? "";
    expect(fontLink).not.toBe("");
    expect(fontLink).toContain('media="print"');
  });
});
