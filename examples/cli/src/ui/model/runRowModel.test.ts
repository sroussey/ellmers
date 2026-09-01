/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sortCliTaskLinesForDisplay } from "./runRowModel";

describe("sortCliTaskLinesForDisplay", () => {
  it("puts settled work first and keeps graph order inside a bucket", () => {
    const order = new Map([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
    const sorted = sortCliTaskLinesForDisplay(
      [
        { id: "a", status: "PENDING" },
        { id: "b", status: "PROCESSING" },
        { id: "c", status: "COMPLETED" },
      ],
      order
    );
    expect(sorted.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});

describe("ui/model is browser-safe", () => {
  it("imports neither ink nor react", () => {
    const dir = new URL(".", import.meta.url).pathname;
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, `${file} must stay renderer-agnostic`).not.toMatch(/from "(ink|react)"/);
    }
  });
});
