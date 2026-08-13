/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { formatCliDuration } from "../ui/formatCliDuration";

describe("formatCliDuration", () => {
  it("returns empty for non-finite or negative", () => {
    expect(formatCliDuration(Number.NaN)).toBe("");
    expect(formatCliDuration(-1)).toBe("");
  });

  it("formats sub-second as ms", () => {
    expect(formatCliDuration(0)).toBe("0ms");
    expect(formatCliDuration(847)).toBe("847ms");
    expect(formatCliDuration(999)).toBe("999ms");
  });

  it("formats seconds under a minute", () => {
    expect(formatCliDuration(1000)).toBe("1.0s");
    expect(formatCliDuration(12_400)).toBe("12.4s");
    expect(formatCliDuration(59_999)).toBe("60.0s");
  });

  it("formats minutes under an hour", () => {
    expect(formatCliDuration(60_000)).toBe("1m");
    expect(formatCliDuration(135_000)).toBe("2m 15s");
    expect(formatCliDuration(3_599_000)).toBe("59m 59s");
  });

  it("formats hours", () => {
    expect(formatCliDuration(3_600_000)).toBe("1h");
    expect(formatCliDuration(3_780_000)).toBe("1h 3m");
    expect(formatCliDuration(7_325_000)).toBe("2h 2m");
  });
});
