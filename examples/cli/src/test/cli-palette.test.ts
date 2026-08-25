/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { cliPaletteFromRgb } from "../terminal/detectTerminalTheme";

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

describe("cliPaletteFromRgb", () => {
  it("mixes both greys away from the page, in whichever direction that is", () => {
    const dark = cliPaletteFromRgb(WHITE, BLACK);
    expect(dark).toEqual({
      level: "advanced",
      fg: "#ffffff",
      bg: "#000000",
      medium: "#404040",
      strong: "#808080",
    });

    // Same distances on a light terminal, so the emphasised mark is darker
    // there rather than brighter. Neither case is special-cased.
    const light = cliPaletteFromRgb(BLACK, WHITE);
    expect(light).toMatchObject({ medium: "#bfbfbf", strong: "#808080" });
  });

  it("keeps the emphasised grey further from the page than the ordinary one", () => {
    for (const [fg, bg] of [
      [WHITE, BLACK],
      [BLACK, WHITE],
      [
        { r: 220, g: 220, b: 204 },
        { r: 40, g: 44, b: 52 },
      ],
    ] as const) {
      const palette = cliPaletteFromRgb(fg, bg);
      if (palette.level !== "advanced") throw new Error("expected an advanced palette");
      const distance = (hex: string): number =>
        Math.abs(parseInt(hex.slice(1, 3), 16) - bg.r) +
        Math.abs(parseInt(hex.slice(3, 5), 16) - bg.g) +
        Math.abs(parseInt(hex.slice(5, 7), 16) - bg.b);
      expect(distance(palette.strong)).toBeGreaterThan(distance(palette.medium));
      expect(distance(palette.strong)).toBeLessThan(distance(palette.fg));
    }
  });
});
