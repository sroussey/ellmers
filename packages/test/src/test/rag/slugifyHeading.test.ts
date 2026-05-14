/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { slugifyHeading } from "@workglow/knowledge-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { snap, report } from "../../binding/testTiming";

let _snap = snap();
beforeEach(() => {
  _snap = snap();
});
afterEach(() => {
  report("slugify", _snap);
});

describe("slugifyHeading", () => {
  it("preserves identifier-shaped headings verbatim", () => {
    expect(slugifyHeading("EncryptedKvCredentialStore")).toBe("EncryptedKvCredentialStore");
    expect(slugifyHeading("API_v2")).toBe("API_v2");
    expect(slugifyHeading("ttl-and-rotation")).toBe("ttl-and-rotation");
  });

  it("collapses whitespace and punctuation runs to a single dash", () => {
    expect(slugifyHeading("Map-Backed Credential Store")).toBe("Map-Backed-Credential-Store");
    expect(slugifyHeading("Why?: Custom Stores")).toBe("Why-Custom-Stores");
    expect(slugifyHeading("Section #1 / Part 2")).toBe("Section-1-Part-2");
    expect(slugifyHeading("foo/bar/baz")).toBe("foo-bar-baz");
  });

  it("trims surrounding whitespace and dashes", () => {
    expect(slugifyHeading("   Leading and Trailing   ")).toBe("Leading-and-Trailing");
    expect(slugifyHeading("---wrapped---")).toBe("wrapped");
    expect(slugifyHeading("  -leading dash  ")).toBe("leading-dash");
  });

  it("returns the empty string for headings with no slug-eligible characters", () => {
    expect(slugifyHeading("???")).toBe("");
    expect(slugifyHeading("   ")).toBe("");
    expect(slugifyHeading("")).toBe("");
  });

  it("preserves case (does not lowercase)", () => {
    expect(slugifyHeading("MixedCASE-Heading")).toBe("MixedCASE-Heading");
  });

  it("is idempotent on already-slugified input", () => {
    const slug = "Map-Backed-Credential-Store";
    expect(slugifyHeading(slug)).toBe(slug);
  });

  // Lockstep corpus. The same algorithm is duplicated in
  // builder/packages/app/vite.config.ts (the MDX rehype heading-id plugin).
  // Vite's config can't reliably resolve workspace package subpaths at
  // build-time, so a live import isn't an option there — instead we pin a
  // fixed corpus here. If you change `slugifyHeading` on either side, this
  // test fails first and reminds you to update the vite.config.ts copy in
  // lockstep. Inputs were chosen to cover the shapes that flow through the
  // rehype pipeline: identifier-CamelCase, multi-word headings,
  // punctuation, and Unicode noise.
  it("matches a fixed corpus to keep the vite.config.ts duplicate in sync", () => {
    const corpus: ReadonlyArray<readonly [string, string]> = [
      ["EncryptedKvCredentialStore", "EncryptedKvCredentialStore"],
      ["Map-Backed Credential Store", "Map-Backed-Credential-Store"],
      ["Why?: Custom Stores", "Why-Custom-Stores"],
      ["Section #1 / Part 2", "Section-1-Part-2"],
      ["API_v2", "API_v2"],
      ["foo/bar/baz", "foo-bar-baz"],
      ["   Leading and Trailing   ", "Leading-and-Trailing"],
      ["---wrapped---", "wrapped"],
      ["MixedCASE-Heading", "MixedCASE-Heading"],
      ["TTL and rotation", "TTL-and-rotation"],
      ["", ""],
      ["???", ""],
      ["café résumé", "caf-r-sum"], // ASCII-only by design; Unicode collapses to dashes
    ];
    for (const [input, expected] of corpus) {
      expect(slugifyHeading(input)).toBe(expected);
    }
  });
});
