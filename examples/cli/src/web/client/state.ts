/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RunEvent } from "../../run-events/RunEventTypes";
import type { RunState } from "../../ui/model/runRowModel";
import type { WebCommandNode } from "../commandTree";

/**
 * The console's view of a run, rebuilt from its event stream.
 *
 * Pure and DOM-free so it can be tested without a browser, which is where the
 * behavior that matters lives: what a row shows, what an iteration map knows,
 * and what survives a reconnect.
 */
export interface RunRow {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly depth: number;
  readonly parent: string | undefined;
  readonly order: number;
  readonly status: string;
  readonly progress: number | undefined;
  readonly message: string | undefined;
  readonly streamText: string;
  readonly messages: unknown;
  readonly usage: { input: number; output: number; cached: number } | undefined;
  readonly startedAt: number | undefined;
  readonly endedAt: number | undefined;
}

/**
 * Above this iteration count the client stops retaining per-index state and
 * tracks only what is running — the same rule, and the same reason, as the
 * terminal: a per-index array copied on every event is O(N) per event and
 * O(N²) over a run.
 */
export const FULL_ITERATION_TRACKING_MAX = 200;

export interface IterationMap {
  readonly count: number;
  readonly running: ReadonlySet<number>;
  readonly done: number;
  readonly slots: ReadonlyMap<number, "pending" | "running" | "completed"> | undefined;
  readonly progress: ReadonlyMap<number, number>;
}

export interface RunViewState {
  readonly rows: ReadonlyMap<string, RunRow>;
  readonly iterations: ReadonlyMap<string, IterationMap>;
  readonly logs: readonly { readonly level: string; readonly text: string }[];
  readonly graphProgress: number | undefined;
  readonly usage: { input: number; output: number; cached: number } | undefined;
  readonly state: RunState | "running";
  readonly error: string | undefined;
  readonly output: unknown;
  readonly humanRequest:
    { readonly requestId: string; readonly message: string; readonly schema: unknown } | undefined;
  readonly lastSeq: number;
  readonly nextOrder: number;
}

export function emptyRunView(): RunViewState {
  return {
    rows: new Map(),
    iterations: new Map(),
    logs: [],
    graphProgress: undefined,
    usage: undefined,
    state: "running",
    error: undefined,
    output: undefined,
    humanRequest: undefined,
    lastSeq: 0,
    nextOrder: 0,
  };
}

function withRow(state: RunViewState, id: string, patch: Partial<RunRow>): RunViewState {
  const existing = state.rows.get(id);
  if (!existing) return state;
  const rows = new Map(state.rows);
  rows.set(id, { ...existing, ...patch });
  return { ...state, rows };
}

const SETTLED = new Set(["COMPLETED", "FAILED", "ABORTED", "DISABLED"]);

export function reduceRunEvent(
  state: RunViewState,
  event: RunEvent,
  at: number = Date.now()
): RunViewState {
  switch (event.k) {
    case "task_added": {
      const rows = new Map(state.rows);
      rows.set(event.id, {
        id: event.id,
        type: event.type,
        label: event.label,
        depth: event.depth,
        parent: event.parent,
        order: state.nextOrder,
        status: "PENDING",
        progress: undefined,
        message: undefined,
        streamText: "",
        messages: undefined,
        usage: undefined,
        startedAt: undefined,
        endedAt: undefined,
      });
      return { ...state, rows, nextOrder: state.nextOrder + 1 };
    }
    case "task_removed": {
      if (!state.rows.has(event.id)) return state;
      const rows = new Map(state.rows);
      rows.delete(event.id);
      return { ...state, rows };
    }
    case "status": {
      const row = state.rows.get(event.id);
      if (!row) return state;
      const starting = event.status === "PROCESSING" && row.startedAt === undefined;
      return withRow(state, event.id, {
        status: event.status,
        startedAt: starting ? at : row.startedAt,
        endedAt: SETTLED.has(event.status) ? at : row.endedAt,
      });
    }
    case "progress":
      return withRow(state, event.id, { progress: event.progress, message: event.message });
    case "text": {
      const row = state.rows.get(event.id);
      if (!row) return state;
      return withRow(state, event.id, { streamText: row.streamText + event.delta });
    }
    case "messages":
      return withRow(state, event.id, { messages: event.messages });
    case "usage":
      return withRow(state, event.id, {
        usage: {
          input: event.input ?? 0,
          output: event.output ?? 0,
          cached: event.cached ?? 0,
        },
      });
    case "graph_progress":
      return { ...state, graphProgress: event.progress };
    case "graph_usage":
      return {
        ...state,
        usage: { input: event.input ?? 0, output: event.output ?? 0, cached: event.cached ?? 0 },
      };
    case "iteration":
      return reduceIteration(state, event);
    case "log":
      return {
        ...state,
        logs: [...state.logs, { level: event.level, text: event.text }].slice(-200),
      };
    case "human_request":
      return {
        ...state,
        humanRequest: {
          requestId: event.requestId,
          message: event.message,
          schema: event.schema,
        },
      };
    // One graph of possibly several finished. The last one wins: a command that
    // runs a sequence ends on the one the operator was waiting for, and the
    // earlier outputs are already in the log.
    case "result":
      return { ...state, output: event.output };
    case "run_end":
      return {
        ...state,
        state: event.state === "" ? "completed" : event.state,
        error: event.error,
        // A `run_end` synthesized from the exit code carries no output, and it
        // must not erase what the graphs actually produced.
        output: event.output ?? state.output,
        // A dead run cannot be answered, so an outstanding prompt goes with it.
        humanRequest: undefined,
      };
    default:
      return state;
  }
}

function reduceIteration(
  state: RunViewState,
  event: Extract<RunEvent, { k: "iteration" }>
): RunViewState {
  const previous =
    state.iterations.get(event.id) ??
    ({
      count: event.count,
      running: new Set<number>(),
      done: 0,
      slots: event.count <= FULL_ITERATION_TRACKING_MAX ? new Map() : undefined,
      progress: new Map(),
    } satisfies IterationMap);

  const running = new Set(previous.running);
  const slots = previous.slots ? new Map(previous.slots) : undefined;
  const progress = new Map(previous.progress);
  let done = previous.done;

  if (event.phase === "start" || event.phase === "progress") {
    running.add(event.index);
    slots?.set(event.index, "running");
    if (event.progress !== undefined) progress.set(event.index, event.progress);
  } else {
    if (running.delete(event.index)) {
      /* it was in flight */
    }
    if (slots?.get(event.index) !== "completed") done += 1;
    slots?.set(event.index, "completed");
    progress.delete(event.index);
  }

  const iterations = new Map(state.iterations);
  iterations.set(event.id, { count: event.count, running, done, slots, progress });
  return { ...state, iterations };
}

/** Applies a numbered event, ignoring one a reconnect replayed twice. */
export function applyRecord(
  state: RunViewState,
  seq: number,
  event: RunEvent,
  at?: number
): RunViewState {
  if (seq <= state.lastSeq) return state;
  return { ...reduceRunEvent(state, event, at), lastSeq: seq };
}

function statusBucket(row: RunRow): number {
  if (row.status === "COMPLETED") return 0;
  if (row.status === "PROCESSING" || row.status === "STREAMING") return 1;
  if (row.status === "PENDING") return 2;
  if (row.status === "FAILED" || row.status === "ABORTED") return 3;
  return 4;
}

/**
 * Rows in the order they should be drawn, every row directly beneath the one
 * that owns it.
 *
 * Arrival order cannot do this on its own. A subgraph's children are reported
 * long after their parent's siblings — the parent has to start running before
 * it owns anything — so a walk that ends a parent's children at the next
 * depth-0 row hands a While Loop's subtasks to whatever root was added last.
 * The rows form a tree, so this walks one.
 */
export function orderedRows(state: RunViewState, sortByStatus: boolean): readonly RunRow[] {
  const all = [...state.rows.values()].sort((a, b) => a.order - b.order);
  const childrenOf = new Map<string, RunRow[]>();
  const roots: RunRow[] = [];
  for (const row of all) {
    // A row whose parent is gone (an iteration clone released mid-flight) is
    // still a row; dropping it would make it vanish rather than settle.
    if (row.parent !== undefined && state.rows.has(row.parent)) {
      const siblings = childrenOf.get(row.parent);
      if (siblings) siblings.push(row);
      else childrenOf.set(row.parent, [row]);
    } else {
      roots.push(row);
    }
  }

  // Only roots re-sort by status. Sorting inside a subtree would reorder a
  // pipeline's steps against the order they run in, which is the one thing the
  // indentation is claiming.
  const ordered = sortByStatus
    ? [...roots].sort((a, b) => statusBucket(a) - statusBucket(b) || a.order - b.order)
    : roots;

  const out: RunRow[] = [];
  const visit = (row: RunRow, seen: Set<string>): void => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    out.push(row);
    for (const child of childrenOf.get(row.id) ?? []) visit(child, seen);
  };
  const seen = new Set<string>();
  for (const root of ordered) visit(root, seen);
  return out;
}

/**
 * What the run screen has to show.
 *
 * Most commands in a CLI never build a task graph — `list`, `detail`, `add`,
 * `remove` all just print — so a screen that only knows how to draw rows spends
 * those runs promising a task that never arrives, with the output the operator
 * actually asked for exiled to a panel underneath. When there are no rows, the
 * command's output IS the run.
 */
export type ConsoleContent = "tasks" | "output" | "waiting";

export function consoleContent(rowCount: number, state: RunViewState): ConsoleContent {
  if (rowCount > 0) return "tasks";
  if (state.logs.length > 0) return "output";
  return "waiting";
}

/** The command's own stdout/stderr, as printed. */
export function runLogText(state: RunViewState): string {
  return state.logs.map((log) => log.text).join("\n");
}

/** Filter state for the command rail. */
export function filterCommandTree(
  nodes: readonly WebCommandNode[],
  query: string
): readonly WebCommandNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;
  const self = (node: WebCommandNode): boolean =>
    `${node.name} ${node.description}`.toLowerCase().includes(needle);
  const matches = (node: WebCommandNode): boolean => self(node) || node.children.some(matches);
  // A node that matches on its own name keeps ALL of its children: searching
  // for `spacs` should show that group's steps, not an empty group you cannot
  // run anything from. Only a node kept for a descendant's sake is pruned.
  const prune = (node: WebCommandNode): WebCommandNode =>
    self(node) ? node : { ...node, children: node.children.filter(matches).map(prune) };
  return nodes.filter(matches).map(prune);
}

/** Every ancestor key of a path, which is what the rail has to open. */
export function openPathsFor(path: readonly string[]): string[] {
  return path.slice(0, -1).map((_, index) => path.slice(0, index + 1).join("."));
}
