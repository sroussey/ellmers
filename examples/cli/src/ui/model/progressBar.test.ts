/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { marqueeBar, unicodeBar } from "./progressBar";

describe("unicodeBar", () => {
  it("fills whole cells and one fractional cell", () => {
    expect(unicodeBar(0, 4)).toBe("▕▏▏▏▏▏");
    expect(unicodeBar(100, 4)).toBe("▕████▏");
    expect(unicodeBar(50, 4)).toBe("▕██▏▏▏");
  });

  it("clamps out-of-range input rather than overflowing the width", () => {
    expect(unicodeBar(-10, 4)).toBe(unicodeBar(0, 4));
    expect(unicodeBar(140, 4)).toBe(unicodeBar(100, 4));
  });
});

describe("marqueeBar", () => {
  it("moves a fixed block across a fixed width", () => {
    const a = marqueeBar(0, 8);
    const b = marqueeBar(4, 8);
    expect(a).toHaveLength(10);
    expect(b).toHaveLength(10);
    expect(a).not.toBe(b);
  });
});
