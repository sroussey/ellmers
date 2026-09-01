/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { CensusList, CensusNode } from "./runCensus";
import {
  hiddenSiblingsLine,
  listCap,
  MAX_VISIBLE_LIST_ROWS,
  planRunViewport,
  scrollGutter,
  stickyRegionHeight,
  tailScrollOffset,
  visibleSlice,
} from "./runViewport";

function node(key: string, lists: readonly CensusList[] = [], ownRows = 1): CensusNode {
  return { key, id: key, status: "PROCESSING", ownRows, countable: true, lists };
}

function listOf(key: string, count: number, child?: (i: number) => CensusList): CensusList {
  return {
    key,
    nodes: Array.from({ length: count }, (_, i) => node(`${key}/${i}`, child ? [child(i)] : [])),
  };
}

describe("planRunViewport", () => {
  it("draws everything when the terminal can hold it", () => {
    const plan = planRunViewport(listOf("", 3), 40);
    expect(plan.rows).toBe(3);
    expect(plan.hidden).toBe(0);
    expect(plan.overflowing).toBe(false);
    expect(listCap(plan, "")).toBe(3);
  });

  it("caps a list at the fixed maximum before the terminal even matters", () => {
    const plan = planRunViewport(listOf("", 40), 400);
    expect(listCap(plan, "")).toBe(MAX_VISIBLE_LIST_ROWS);
    // The row naming what is hidden is itself drawn.
    expect(plan.rows).toBe(MAX_VISIBLE_LIST_ROWS + 1);
    expect(plan.hidden).toBe(40 - MAX_VISIBLE_LIST_ROWS);
  });

  it("takes the rows from the innermost list, leaving the ancestors whole", () => {
    // A map's row, and beneath it a long list of per-item detail: exactly the
    // shape where trimming the parent to fit more children is backwards.
    const tree: CensusList = {
      key: "",
      nodes: [node("/map", [listOf("/map", 6, (i) => listOf(`/map/${i}`, 6))])],
    };
    const roomy = planRunViewport(tree, 200);
    expect(listCap(roomy, "")).toBe(1);
    expect(listCap(roomy, "/map")).toBe(6);

    const tight = planRunViewport(tree, 12);
    expect(tight.rows).toBeLessThanOrEqual(12);
    // The parent row and its own children survive; the grandchildren pay.
    expect(listCap(tight, "")).toBe(1);
    expect(listCap(tight, "/map")).toBeGreaterThan(1);
    for (let i = 0; i < 6; i++) {
      expect(listCap(tight, `/map/${i}`)).toBeLessThan(6);
    }
  });

  it("climbs to a shallower list once the deepest one is down to a single row", () => {
    const tree: CensusList = {
      key: "",
      nodes: [node("/a", [listOf("/a", 6, (i) => listOf(`/a/${i}`, 6))])],
    };
    const plan = planRunViewport(tree, 6);
    for (let i = 0; i < 6; i++) {
      expect(listCap(plan, `/a/${i}`)).toBe(1);
    }
    expect(listCap(plan, "/a")).toBeLessThan(6);
  });

  it("counts as hidden only what the rows it draws are holding back", () => {
    // Twelve top-level nodes, each owning twelve of its own. Only the six
    // top-level nodes on screen have lists anyone is reading; the six capped
    // away take their children with them, and counting those again reports a
    // number no part of the display corresponds to.
    const tree = listOf("", 12, (i) => listOf(`/${i}`, 12));
    const plan = planRunViewport(tree, 200);
    const perVisibleList = 12 - MAX_VISIBLE_LIST_ROWS;
    expect(plan.hidden).toBe(perVisibleList + MAX_VISIBLE_LIST_ROWS * perVisibleList);
  });

  it("spends its shrink steps only on lists it is drawing", () => {
    // A list under a node the root already capped away frees no row when it
    // shrinks. Taking rows off those instead would burn the search's budget
    // without the plan ever fitting.
    const tree = listOf("", 12, (i) => listOf(`/${i}`, 12));
    const plan = planRunViewport(tree, 20);
    expect(plan.rows).toBeLessThanOrEqual(20);
    expect(listCap(plan, "/0")).toBe(MAX_VISIBLE_LIST_ROWS);
  });

  it("gives up rather than erasing the run when nothing more can be given back", () => {
    const plan = planRunViewport(listOf("", 3), 0);
    expect(plan.overflowing).toBe(true);
    // One row of the run survives, plus the line saying what it is standing in for.
    expect(listCap(plan, "")).toBe(1);
    expect(plan.rows).toBe(2);
  });

  it("prices a failed row at what it actually draws", () => {
    const tall: CensusList = { key: "", nodes: [node("/a", [], 4)] };
    expect(planRunViewport(tall, 40).rows).toBe(4);
  });
});

describe("visibleSlice", () => {
  it("keeps the tail, where the live work sorts", () => {
    expect(visibleSlice([1, 2, 3, 4, 5], 2)).toEqual([4, 5]);
    expect(visibleSlice([1, 2], 9)).toEqual([1, 2]);
    expect(visibleSlice([1, 2], 0)).toEqual([]);
  });
});

describe("stickyRegionHeight", () => {
  it("grows to fit new content", () => {
    expect(stickyRegionHeight({ naturalRows: 9, heldRows: 4, budgetRows: 30 })).toBe(9);
  });

  it("holds its height when the content shrinks, so the footer stays put", () => {
    expect(stickyRegionHeight({ naturalRows: 2, heldRows: 9, budgetRows: 30 })).toBe(9);
  });

  it("never outgrows the window, and gives rows back when the window shrinks", () => {
    expect(stickyRegionHeight({ naturalRows: 40, heldRows: 40, budgetRows: 12 })).toBe(12);
    expect(stickyRegionHeight({ naturalRows: 3, heldRows: 40, budgetRows: 12 })).toBe(12);
  });
});

describe("scroll gutter", () => {
  it("reports nothing to scroll as blank, not as a full bar", () => {
    expect(scrollGutter({ totalRows: 4, visibleRows: 6, offsetRows: 0 })).toEqual([
      " ",
      " ",
      " ",
      " ",
      " ",
      " ",
    ]);
  });

  it("sizes the thumb by the share on screen and parks it at the view", () => {
    const gutter = scrollGutter({ totalRows: 20, visibleRows: 5, offsetRows: 15 });
    expect(gutter).toHaveLength(5);
    // Pinned to the tail: the thumb sits at the bottom of the track.
    expect(gutter[4]).toBe("┃");
    expect(gutter[0]).toBe("│");
    expect(gutter.filter((g) => g === "┃")).toHaveLength(1);
  });

  it("puts the thumb at the top when nothing is scrolled off", () => {
    const gutter = scrollGutter({ totalRows: 10, visibleRows: 5, offsetRows: 0 });
    expect(gutter[0]).toBe("┃");
    expect(gutter[4]).toBe("│");
  });
});

describe("tailScrollOffset", () => {
  it("shows the end of the content", () => {
    expect(tailScrollOffset(30, 10)).toBe(20);
    expect(tailScrollOffset(4, 10)).toBe(0);
  });
});

describe("hiddenSiblingsLine", () => {
  it("reports what is hidden by outcome", () => {
    expect(hiddenSiblingsLine(["COMPLETED", "COMPLETED", "FAILED", "PENDING"])).toBe(
      "▲ 2 done · 1 failed · 1 more"
    );
    expect(hiddenSiblingsLine([])).toBe("");
  });
});
