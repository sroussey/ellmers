/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { clampRailWidth, loadRailWidths, RAIL_DEFAULTS, saveRailWidths } from "./railWidths";

function memoryStore(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set("workglow.web.railWidths", initial);
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    read: () => map.get("workglow.web.railWidths"),
  };
}

describe("clampRailWidth", () => {
  it("keeps a rail usable rather than letting a drag collapse it", () => {
    expect(clampRailWidth("left", 20, 1600, 248)).toBe(200);
    expect(clampRailWidth("right", 0, 1600, 266)).toBe(180);
  });

  it("stops a rail from eating the centre column", () => {
    // 1000 wide, the other rail at 200: the widest this one may be is 440.
    expect(clampRailWidth("left", 900, 1000, 200)).toBe(440);
  });

  it("caps a rail even when the window could afford more", () => {
    expect(clampRailWidth("left", 5000, 4000, 248)).toBe(560);
  });

  it("prefers an overflowing rail to a collapsed one on a narrow window", () => {
    // The budget here is negative; the minimum has to win, because a rail with
    // no width is unusable while a wide one still shows its contents.
    expect(clampRailWidth("right", 300, 600, 266)).toBe(180);
  });
});

describe("rail width persistence", () => {
  it("round-trips through the store", () => {
    const store = memoryStore();
    saveRailWidths({ left: 320, right: 210 }, store);
    expect(loadRailWidths(store)).toEqual({ left: 320, right: 210 });
  });

  it("falls back to the defaults when nothing is stored", () => {
    expect(loadRailWidths(memoryStore())).toEqual(RAIL_DEFAULTS);
  });

  it("ignores a corrupt or out-of-range entry", () => {
    // A bad entry must not leave the page with no rails at all.
    expect(loadRailWidths(memoryStore("not json"))).toEqual(RAIL_DEFAULTS);
    expect(loadRailWidths(memoryStore('{"left":-40,"right":"wide"}'))).toEqual({
      left: 200,
      right: RAIL_DEFAULTS.right,
    });
  });

  it("survives a store that throws", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadRailWidths(hostile)).toEqual(RAIL_DEFAULTS);
    expect(() => saveRailWidths({ left: 300, right: 300 }, hostile)).not.toThrow();
  });
});
