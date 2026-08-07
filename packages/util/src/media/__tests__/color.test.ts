/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ColorObject } from "@workglow/util/media";
import {
  isColorObject,
  isHexColor,
  parseHexColor,
  resolveColor,
  toHexColor,
} from "@workglow/util/media";
import { describe, expect, it } from "vitest";

describe("parseHexColor", () => {
  it("parses #RRGGBB", () => {
    expect(parseHexColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(parseHexColor("#00FF00")).toEqual({ r: 0, g: 255, b: 0, a: 255 });
    expect(parseHexColor("#0000ff")).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  });

  it("parses #RRGGBBAA with alpha", () => {
    expect(parseHexColor("#ff000080")).toEqual({ r: 255, g: 0, b: 0, a: 128 });
    expect(parseHexColor("#00000000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseHexColor("#ffffffff")).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });

  it("expands #RGB shorthand by doubling each nibble", () => {
    expect(parseHexColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(parseHexColor("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 255 });
  });

  it("expands #RGBA shorthand", () => {
    expect(parseHexColor("#f008")).toEqual({ r: 255, g: 0, b: 0, a: 0x88 });
    expect(parseHexColor("#0000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("is case-insensitive on input", () => {
    expect(parseHexColor("#AbCdEf")).toEqual(parseHexColor("#abcdef"));
    expect(parseHexColor("#AbCdEf12")).toEqual(parseHexColor("#abcdef12"));
  });

  it("throws on missing leading #", () => {
    expect(() => parseHexColor("ff0000")).toThrow();
  });

  it("throws on non-hex characters", () => {
    expect(() => parseHexColor("#gg0000")).toThrow();
    expect(() => parseHexColor("#ff00zz")).toThrow();
  });

  it("throws on invalid lengths", () => {
    expect(() => parseHexColor("#")).toThrow();
    expect(() => parseHexColor("#f")).toThrow();
    expect(() => parseHexColor("#ff")).toThrow();
    expect(() => parseHexColor("#fffff")).toThrow();
    expect(() => parseHexColor("#fffffff")).toThrow();
    expect(() => parseHexColor("#fffffffff")).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => parseHexColor("")).toThrow();
  });

  it("throws on whitespace-padded input (no trim)", () => {
    expect(() => parseHexColor(" #ff0000")).toThrow();
    expect(() => parseHexColor("#ff0000 ")).toThrow();
  });

  it("throws on non-string input", () => {
    expect(() => parseHexColor(null as unknown as string)).toThrow();
    expect(() => parseHexColor(undefined as unknown as string)).toThrow();
    expect(() => parseHexColor(123 as unknown as string)).toThrow();
  });
});

describe("toHexColor", () => {
  it("emits #RRGGBB when alpha is 255", () => {
    expect(toHexColor({ r: 255, g: 0, b: 0, a: 255 })).toBe("#ff0000");
    expect(toHexColor({ r: 0, g: 255, b: 0, a: 255 })).toBe("#00ff00");
    expect(toHexColor({ r: 0, g: 0, b: 255, a: 255 })).toBe("#0000ff");
  });

  it("emits #RRGGBBAA when alpha < 255", () => {
    expect(toHexColor({ r: 255, g: 0, b: 0, a: 128 })).toBe("#ff000080");
    expect(toHexColor({ r: 0, g: 0, b: 0, a: 0 })).toBe("#00000000");
    expect(toHexColor({ r: 170, g: 187, b: 204, a: 136 })).toBe("#aabbcc88");
  });

  it("emits lowercase only", () => {
    expect(toHexColor({ r: 0xab, g: 0xcd, b: 0xef, a: 255 })).toBe("#abcdef");
  });

  it("never emits 3/4-digit shorthand", () => {
    expect(toHexColor({ r: 255, g: 0, b: 0, a: 255 })).toBe("#ff0000");
    expect(toHexColor({ r: 255, g: 0, b: 0, a: 0 })).toBe("#ff000000");
  });

  it("round-trips 6-digit and 8-digit hex", () => {
    for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#123456", "#abcdef12", "#00000080"]) {
      expect(toHexColor(parseHexColor(hex))).toBe(hex);
    }
  });

  it("expands 3/4-digit shorthand to long lowercase form after round trip", () => {
    expect(toHexColor(parseHexColor("#f00"))).toBe("#ff0000");
    expect(toHexColor(parseHexColor("#ABC"))).toBe("#aabbcc");
    expect(toHexColor(parseHexColor("#f008"))).toBe("#ff000088");
  });

  it("throws on non-integer channels", () => {
    expect(() => toHexColor({ r: 1.5, g: 0, b: 0, a: 255 })).toThrow();
    expect(() => toHexColor({ r: 0, g: NaN, b: 0, a: 255 })).toThrow();
  });

  it("throws on out-of-range channels", () => {
    expect(() => toHexColor({ r: -1, g: 0, b: 0, a: 255 })).toThrow();
    expect(() => toHexColor({ r: 256, g: 0, b: 0, a: 255 })).toThrow();
    expect(() => toHexColor({ r: 0, g: 0, b: 0, a: 300 })).toThrow();
  });
});

describe("resolveColor", () => {
  it("normalizes a full ColorObject", () => {
    expect(resolveColor({ r: 1, g: 2, b: 3, a: 4 })).toEqual({ r: 1, g: 2, b: 3, a: 4 });
  });

  it("defaults alpha to 255 when missing from object input", () => {
    const result = resolveColor({ r: 10, g: 20, b: 30 } as unknown as ColorObject);
    expect(result).toEqual({ r: 10, g: 20, b: 30, a: 255 });
  });

  it("parses a hex string input", () => {
    expect(resolveColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(resolveColor("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 255 });
    expect(resolveColor("#00000080")).toEqual({ r: 0, g: 0, b: 0, a: 128 });
  });

  it("parses CSS rgb and rgba string inputs", () => {
    expect(resolveColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 255 });
    expect(resolveColor("rgba(10, 20, 30, 0.25)")).toEqual({ r: 10, g: 20, b: 30, a: 64 });
  });

  it("throws on invalid hex", () => {
    expect(() => resolveColor("ff0000")).toThrow();
    expect(() => resolveColor("#zzzzzz")).toThrow();
  });

  it("throws on invalid CSS rgb values", () => {
    expect(() => resolveColor("rgb(256, 0, 0)")).toThrow();
    expect(() => resolveColor("rgba(0, 0, 0, 1.5)")).toThrow();
  });

  it("throws on out-of-range object channels", () => {
    expect(() => resolveColor({ r: 300, g: 0, b: 0, a: 255 })).toThrow();
    expect(() => resolveColor({ r: -1, g: 0, b: 0, a: 255 })).toThrow();
  });

  it("throws on non-object non-string input", () => {
    expect(() => resolveColor(null as unknown as ColorObject)).toThrow();
    expect(() => resolveColor(undefined as unknown as ColorObject)).toThrow();
    expect(() => resolveColor(123 as unknown as ColorObject)).toThrow();
    expect(() => resolveColor({ foo: "bar" } as unknown as ColorObject)).toThrow();
  });
});

describe("isColorObject", () => {
  it("returns true for a valid full RGBA object", () => {
    expect(isColorObject({ r: 1, g: 2, b: 3, a: 4 })).toBe(true);
  });

  it("returns true when alpha is omitted", () => {
    expect(isColorObject({ r: 1, g: 2, b: 3 })).toBe(true);
  });

  it("returns false when any channel is out of range or non-integer", () => {
    expect(isColorObject({ r: -1, g: 0, b: 0 })).toBe(false);
    expect(isColorObject({ r: 256, g: 0, b: 0 })).toBe(false);
    expect(isColorObject({ r: 1.5, g: 0, b: 0 })).toBe(false);
    expect(isColorObject({ r: 0, g: 0, b: 0, a: 300 })).toBe(false);
  });

  it("returns false for non-objects, nulls, strings, arrays", () => {
    expect(isColorObject(null)).toBe(false);
    expect(isColorObject(undefined)).toBe(false);
    expect(isColorObject("#ff0000")).toBe(false);
    expect(isColorObject([1, 2, 3])).toBe(false);
    expect(isColorObject(123)).toBe(false);
  });
});

describe("isHexColor", () => {
  it("returns true for valid hex forms", () => {
    for (const x of ["#f00", "#f008", "#ff0000", "#ff000080", "#ABCDEF"]) {
      expect(isHexColor(x)).toBe(true);
    }
  });

  it("returns false for invalid inputs", () => {
    for (const x of ["ff0000", "#gg0000", "#", "#f", "#fffff", "#fffffff", "", 123, null]) {
      expect(isHexColor(x)).toBe(false);
    }
  });
});
