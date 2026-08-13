/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";

// Loaded via runtime-string dynamic import to keep `tsc --build` from pulling
// the script (outside this package's rootDir) into the project graph.
interface ParseDotEnvModule {
  parseDotEnv: (source: string) => ReadonlyMap<string, string>;
}

let parseDotEnv: ParseDotEnvModule["parseDotEnv"];

beforeAll(async () => {
  // Absolute, via import.meta.url: a bare relative string is resolved against
  // this module's ROOT-RELATIVE url, so the number of `../` needed depends on
  // where the vitest project root sits — which is per-package now.
  const modulePath = new URL("../../../../../scripts/lib/parse-dot-env.ts", import.meta.url).href;
  const mod = (await import(/* @vite-ignore */ modulePath)) as ParseDotEnvModule;
  parseDotEnv = mod.parseDotEnv;
});

describe("parseDotEnv", () => {
  it("parses simple unquoted KEY=VALUE", () => {
    const result = parseDotEnv("FOO=bar\nBAZ=qux");
    expect(Object.fromEntries(result)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("ignores blank lines and full-line comments", () => {
    const result = parseDotEnv(
      ["", "# header", "  # indented", "FOO=bar", "", "  ", "BAZ=qux"].join("\n")
    );
    expect(Object.fromEntries(result)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("strips the `export ` prefix", () => {
    const result = parseDotEnv("export FOO=bar");
    expect(result.get("FOO")).toBe("bar");
  });

  it("strips trailing inline comments from unquoted values", () => {
    const result = parseDotEnv("FOO=bar   # trailing");
    expect(result.get("FOO")).toBe("bar");
  });

  it("preserves `#` inside single-quoted values and strips trailing comments", () => {
    const result = parseDotEnv("FOO='value#with#hash'   # trailing");
    expect(result.get("FOO")).toBe("value#with#hash");
  });

  it("preserves `#` inside double-quoted values and strips trailing comments", () => {
    const result = parseDotEnv('FOO="value#with#hash"   # trailing');
    expect(result.get("FOO")).toBe("value#with#hash");
  });

  it("interprets escapes inside double-quoted values", () => {
    const result = parseDotEnv('FOO="line1\\nline2\\ttab\\\"quote\\\\back"');
    expect(result.get("FOO")).toBe('line1\nline2\ttab"quote\\back');
  });

  it("does NOT interpret escapes inside single-quoted values", () => {
    const result = parseDotEnv("FOO='line1\\nline2'");
    expect(result.get("FOO")).toBe("line1\\nline2");
  });

  it("throws on malformed lines", () => {
    expect(() => parseDotEnv("not a valid line")).toThrow(/malformed/);
  });

  it("throws on unterminated quoted values", () => {
    expect(() => parseDotEnv('FOO="never ends')).toThrow(/unterminated/);
  });

  it("handles CRLF line endings", () => {
    const result = parseDotEnv("FOO=bar\r\nBAZ=qux");
    expect(Object.fromEntries(result)).toEqual({ FOO: "bar", BAZ: "qux" });
  });
});
