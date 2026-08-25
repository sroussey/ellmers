/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { CensusList, CensusNode } from "./runCensus";
import { EMPTY_RUN_CENSUS_LEDGER, flattenCensus, mergeRunCensus, runTaskCounts } from "./runCensus";

function node(
  key: string,
  status: string,
  lists: readonly CensusList[] = [],
  countable = true
): CensusNode {
  return { key, id: key, status, ownRows: 1, countable, lists };
}

function list(key: string, nodes: readonly CensusNode[]): CensusList {
  return { key, nodes };
}

describe("run census ledger", () => {
  it("counts every task the tree contains, not just its top level", () => {
    const tree = list("", [
      node("/a", "COMPLETED"),
      node("/b", "PROCESSING", [
        list("/b", [
          node("/b/1", "COMPLETED"),
          node("/b/2", "PROCESSING", [list("/b/2", [node("/b/2/x", "PENDING")])]),
        ]),
      ]),
    ]);
    const counts = runTaskCounts(mergeRunCensus(EMPTY_RUN_CENSUS_LEDGER, tree));
    expect(counts).toEqual({
      done: 2,
      total: 5,
      running: 2,
      failed: 0,
      approximate: false,
    });
  });

  it("leaves a grouping node out of the count it only lays out", () => {
    // A Map iteration is a bracket around the clone's real tasks, not a task.
    const tree = list("", [
      node("/m", "PROCESSING", [
        list("/m#", [
          {
            ...node("/m#0", "PROCESSING", [list("/m#0", [node("/m#0/t", "PROCESSING")])]),
            countable: false,
            ownRows: 0,
          },
        ]),
      ]),
    ]);
    expect(runTaskCounts(mergeRunCensus(EMPTY_RUN_CENSUS_LEDGER, tree)).total).toBe(2);
    expect([...flattenCensus(tree).counted.keys()]).toEqual(["/m", "/m#0/t"]);
    expect([...flattenCensus(tree).structural]).toEqual(["/m#0"]);
  });

  it("keeps a total that only ever climbs as iterations retire", () => {
    let ledger = mergeRunCensus(
      EMPTY_RUN_CENSUS_LEDGER,
      list("", [node("/m", "PROCESSING", [list("/m#0", [node("/m#0/t", "PROCESSING")])])])
    );
    expect(runTaskCounts(ledger).total).toBe(2);

    // The iterator retires the finished clone and starts the next one. A live
    // view of the tree has lost the first; the ledger has not, and credits it.
    ledger = mergeRunCensus(
      ledger,
      list("", [node("/m", "PROCESSING", [list("/m#1", [node("/m#1/t", "PROCESSING")])])])
    );
    const counts = runTaskCounts(ledger);
    expect(counts.total).toBe(3);
    expect(counts.done).toBe(1);
  });

  it("credits an evicted iteration the poll only ever caught as pending", () => {
    // The walk is a 250ms poll and an iteration's inner task can start and
    // finish between two of them. Requiring it to have been seen mid-run would
    // leave one un-credited key per such iteration and stall `done` short of
    // `total` by however many the poll happened to miss.
    let ledger = mergeRunCensus(
      EMPTY_RUN_CENSUS_LEDGER,
      list("", [node("/m", "PROCESSING", [list("/m#0", [node("/m#0/t", "PENDING")])])])
    );
    expect(runTaskCounts(ledger)).toMatchObject({ done: 0, total: 2 });

    ledger = mergeRunCensus(
      ledger,
      list("", [node("/m", "PROCESSING", [list("/m#1", [node("/m#1/t", "PROCESSING")])])])
    );
    expect(runTaskCounts(ledger)).toMatchObject({ done: 1, total: 3 });
  });

  it("does not un-settle a task a reused node re-registered", () => {
    let ledger = mergeRunCensus(EMPTY_RUN_CENSUS_LEDGER, list("", [node("/a", "COMPLETED")]));
    ledger = mergeRunCensus(ledger, list("", [node("/a", "PENDING")]));
    expect(runTaskCounts(ledger).done).toBe(1);
  });

  it("returns the same ledger when a walk teaches it nothing", () => {
    const tree = list("", [node("/a", "PROCESSING")]);
    const first = mergeRunCensus(EMPTY_RUN_CENSUS_LEDGER, tree);
    expect(mergeRunCensus(first, tree)).toBe(first);
  });

  it("stops recording past the cap and says the total is a floor", () => {
    const nodes = Array.from({ length: 5 }, (_, i) => node(`/n${i}`, "PENDING"));
    const counts = runTaskCounts(mergeRunCensus(EMPTY_RUN_CENSUS_LEDGER, list("", nodes), 3));
    expect(counts.total).toBe(3);
    expect(counts.approximate).toBe(true);
  });

  it("drops a wrapper the walk later recognises as scaffolding", () => {
    // Owned first, before its workflow starts: indistinguishable from a real
    // pending task, so it is counted.
    let ledger = mergeRunCensus(
      EMPTY_RUN_CENSUS_LEDGER,
      list("", [node("/w", "PENDING", [list("/w", [node("/w/a", "PENDING")])])])
    );
    expect(runTaskCounts(ledger).total).toBe(2);

    // Its child runs and finishes while it never leaves PENDING. It is a
    // bracket around the work, and the run is done when the work is.
    ledger = mergeRunCensus(
      ledger,
      list("", [
        { ...node("/w", "PENDING", [list("/w", [node("/w/a", "COMPLETED")])]), countable: false },
      ])
    );
    const counts = runTaskCounts(ledger);
    expect(counts).toMatchObject({ done: 1, total: 1 });
  });

  it("separates failures from work still to come", () => {
    const counts = runTaskCounts(
      mergeRunCensus(
        EMPTY_RUN_CENSUS_LEDGER,
        list("", [node("/a", "FAILED"), node("/b", "ABORTED"), node("/c", "PENDING")])
      )
    );
    expect(counts.failed).toBe(2);
    expect(counts.done).toBe(0);
    expect(counts.total).toBe(3);
  });
});
