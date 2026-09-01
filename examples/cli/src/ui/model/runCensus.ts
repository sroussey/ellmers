/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a run actually contains, independent of what draws it.
 *
 * A graph's top-level tasks are the smallest true thing a run footer can
 * report, and for most real pipelines they are also the least interesting one:
 * a task that owns a workflow, regenerates a subgraph, or maps over a worklist
 * does the bulk of the work in nodes the top level never mentions. Counting
 * only those rows told an operator "1 / 3 tasks" while several hundred were in
 * flight.
 *
 * This module holds two things the renderers share: the shape of a run's task
 * tree ({@link CensusList} / {@link CensusNode}), and a ledger that accumulates
 * what the tree has ever contained. The ledger matters because the tree is a
 * live view — a Map keeps only the iterations in flight, so its finished clones
 * vanish from the walk — and a total that falls as work completes is worse than
 * no total at all.
 *
 * Nothing here may import a renderer; `runRowModel.test.ts` enforces that for
 * this directory.
 */

/** A sibling group the UI draws as one indented list. */
export interface CensusList {
  /** Stable path of the list — `""` for the run's root list. */
  readonly key: string;
  readonly nodes: readonly CensusNode[];
}

/** One task in the tree, with whatever lists it draws beneath itself. */
export interface CensusNode {
  /** Stable path: the parent list's key, then this node's task id. */
  readonly key: string;
  readonly id: string;
  readonly status: string;
  /**
   * Terminal rows this node draws for itself — its status line, plus a usage
   * line or an error detail when it has one. Children are counted separately.
   */
  readonly ownRows: number;
  /** Owned subgraph, or the group of live Map/Reduce iterations. */
  readonly lists: readonly CensusList[];
  /**
   * False for a node that stands for something other than a task — a Map
   * iteration, which is a grouping the rows draw around the clone's real tasks.
   * Such a node is laid out like any other and counted like nothing at all,
   * because the tasks inside it are already the work.
   */
  readonly countable: boolean;
}

export const EMPTY_CENSUS_LIST: CensusList = { key: "", nodes: [] };

/**
 * Every task the run has been seen to contain, by path, with the last status
 * observed for it. Keys are never dropped: a finished Map iteration is work the
 * run did, and forgetting it would walk the total backwards.
 */
export interface RunCensusLedger {
  readonly statusByKey: ReadonlyMap<string, string>;
  /** True once {@link MAX_LEDGER_KEYS} was hit and new paths stopped being recorded. */
  readonly truncated: boolean;
}

export const EMPTY_RUN_CENSUS_LEDGER: RunCensusLedger = {
  statusByKey: new Map(),
  truncated: false,
};

/**
 * Ceiling on remembered paths. A Map over a million-row worklist would
 * otherwise retain a key per iteration per inner task, which is a leak dressed
 * up as a counter. Past the cap the total is reported as approximate rather
 * than silently wrong.
 */
export const MAX_LEDGER_KEYS = 20_000;

const SETTLED = new Set(["COMPLETED", "FAILED", "ABORTED", "DISABLED"]);

function isRunning(status: string): boolean {
  return status === "PROCESSING" || status === "STREAMING" || status === "ABORTING";
}

/** What one walk of the tree found, split by whether it is work or scaffolding. */
export interface CensusSample {
  /** Real tasks, by path, with the status seen for each. */
  readonly counted: ReadonlyMap<string, string>;
  /** Paths the walk found and deliberately did not count. */
  readonly structural: ReadonlySet<string>;
}

function collect(list: CensusList, counted: Map<string, string>, structural: Set<string>): void {
  for (const node of list.nodes) {
    if (node.countable) counted.set(node.key, node.status);
    else structural.add(node.key);
    for (const child of node.lists) collect(child, counted, structural);
  }
}

/** Flattens a census tree, depth-first in display order. */
export function flattenCensus(root: CensusList): CensusSample {
  const counted = new Map<string, string>();
  const structural = new Set<string>();
  collect(root, counted, structural);
  return { counted, structural };
}

/**
 * Folds one walk of the live tree into the ledger.
 *
 * A path that has not settled and is no longer in the tree has been evicted,
 * which for the only thing that evicts — an iterator retiring a finished clone
 * — means it completed. Recording it as settled is what keeps `done` climbing
 * to meet `total` instead of stalling a few hundred short of it. A task
 * released with `disown` takes the same path and is credited the same way; the
 * alternative is a run that never reads as finished.
 *
 * Crediting turns on *not settled*, not on *running*: the walk is a 250ms poll
 * and a short task inside a Map clone is routinely seen once as PENDING and
 * then never again. Requiring it to have been caught mid-run would leave one
 * un-credited key per such iteration, and `done` would stop short of `total`
 * by however many the poll happened to miss.
 *
 * Returns the ledger unchanged when the walk taught it nothing, so a caller can
 * use identity to skip a re-render.
 */
export function mergeRunCensus(
  ledger: RunCensusLedger,
  root: CensusList,
  maxKeys: number = MAX_LEDGER_KEYS
): RunCensusLedger {
  const { counted: seen, structural } = flattenCensus(root);
  let next: Map<string, string> | undefined;
  let truncated = ledger.truncated;

  const edit = (): Map<string, string> => {
    next ??= new Map(ledger.statusByKey);
    return next;
  };

  for (const [key, status] of seen) {
    const known = ledger.statusByKey.get(key);
    if (known === status) continue;
    if (known === undefined && (next ?? ledger.statusByKey).size >= maxKeys) {
      truncated = true;
      continue;
    }
    // A settled row never un-settles: a reused node re-registered for another
    // batch would otherwise walk `done` backwards mid-run.
    if (known !== undefined && SETTLED.has(known) && !SETTLED.has(status)) continue;
    edit().set(key, status);
  }

  // A path the walk has since decided is scaffolding — an owned wrapper whose
  // children turned out to be what runs — must leave the ledger, or it is a
  // task that can never finish and a total that can never be met.
  for (const key of structural) {
    if (ledger.statusByKey.has(key)) edit().delete(key);
  }

  for (const [key, status] of ledger.statusByKey) {
    if (seen.has(key) || structural.has(key) || SETTLED.has(status)) continue;
    edit().set(key, "COMPLETED");
  }

  if (!next && truncated === ledger.truncated) return ledger;
  return { statusByKey: next ?? ledger.statusByKey, truncated };
}

/** What the footer reports about the run's shape. */
export interface RunTaskCounts {
  readonly done: number;
  readonly total: number;
  readonly running: number;
  readonly failed: number;
  /** True when the ledger stopped recording paths; the total is a floor. */
  readonly approximate: boolean;
}

export const EMPTY_RUN_TASK_COUNTS: RunTaskCounts = {
  done: 0,
  total: 0,
  running: 0,
  failed: 0,
  approximate: false,
};

export function runTaskCounts(ledger: RunCensusLedger): RunTaskCounts {
  let done = 0;
  let running = 0;
  let failed = 0;
  for (const status of ledger.statusByKey.values()) {
    if (status === "COMPLETED" || status === "DISABLED") done++;
    else if (status === "FAILED" || status === "ABORTED") failed++;
    else if (isRunning(status)) running++;
  }
  return {
    done,
    total: ledger.statusByKey.size,
    running,
    failed,
    approximate: ledger.truncated,
  };
}
