/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task, Workflow, type IExecuteContext } from "@workglow/task-graph";
import { Box, render, Text, useWindowSize } from "ink";
import { EventEmitter } from "node:events";
import React, { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";
import { ScrollRegion } from "../ui/components/ScrollRegion";
import { WorkflowRunApp } from "../ui/WorkflowRunApp";

const SCHEMA = { type: "object", properties: {} } as never;

/** Stdout Ink treats as a live terminal, so every frame reaches the test. */
class FakeTerminal extends EventEmitter {
  readonly isTTY = true;
  columns = 100;
  rows: number;
  readonly frames: string[] = [];

  constructor(rows: number) {
    super();
    this.rows = rows;
  }

  write(data: string): boolean {
    this.frames.push(data);
    return true;
  }

  resizeTo(rows: number, columns?: number): void {
    this.rows = rows;
    if (columns !== undefined) this.columns = columns;
    this.emit("resize");
  }
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;?]*[a-z]/gi, "");

/**
 * The last frame that actually drew something. Ink's trailing writes are cursor
 * and synchronised-update escapes, which carry no rows at all.
 */
function lastFrameLines(stdout: FakeTerminal): string[] {
  const drawn = [...stdout.frames].reverse().find((f) => f.includes("\n")) ?? "";
  const lines = stripAnsi(drawn).split("\n");
  // Ink terminates the frame with a newline; that is not a row.
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function indexOfLine(lines: readonly string[], text: string): number {
  return lines.findIndex((line) => line.includes(text));
}

const ERASE_SCREEN = "\u001B[2J\u001B[H";

/**
 * Ink decides whether to draw frames as it goes from `!isInCi && stdout.isTTY`,
 * and under a CI runner that resolves to non-interactive: erase sequences and
 * resize handling are off and only the final frame is written, at unmount. Every
 * assertion here reads a frame mid-run, so they all found an empty screen on CI
 * and passed on a developer's machine. The option exists for exactly this — the
 * behaviour under test is what a terminal shows, so the tests state that they
 * want a terminal rather than inferring one from the environment.
 */
const INK_OPTIONS = (stdout: FakeTerminal) =>
  ({
    stdout: stdout as never,
    patchConsole: false,
    exitOnCtrlC: false,
    interactive: true,
  }) as const;

const settle = (ms = 250): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A region whose content count the test drives. */
function ShrinkingRegion({
  budgetRows,
  initial,
  onReady,
}: {
  readonly budgetRows: number;
  readonly initial: number;
  readonly onReady: (setCount: (n: number) => void) => void;
}): React.ReactElement {
  const [count, setCount] = useState(initial);
  useEffect(() => {
    onReady(setCount);
  }, [onReady]);
  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(
      ScrollRegion,
      { budgetRows, key: "region" },
      ...Array.from({ length: count }, (_, i) => React.createElement(Text, { key: i }, `row-${i}`))
    ),
    React.createElement(Text, { key: "foot" }, "FOOTER")
  );
}

/** A region budgeted from the live window, the way the run apps budget theirs. */
function WindowSizedRegion({
  reserveRows,
  count,
}: {
  readonly reserveRows: number;
  readonly count: number;
}): React.ReactElement {
  const size = useWindowSize();
  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(
      ScrollRegion,
      { budgetRows: size.rows - reserveRows, key: "region" },
      ...Array.from({ length: count }, (_, i) => React.createElement(Text, { key: i }, `row-${i}`))
    ),
    React.createElement(Text, { key: "foot" }, "FOOTER")
  );
}

describe("the live region's height", () => {
  it("grows with its content and then holds, so the footer stops moving", async () => {
    const stdout = new FakeTerminal(40);
    let setCount: ((n: number) => void) | undefined;
    const instance = render(
      React.createElement(ShrinkingRegion, {
        budgetRows: 20,
        initial: 8,
        onReady: (fn) => {
          setCount = fn;
        },
      }),
      INK_OPTIONS(stdout)
    );

    await settle();
    expect(indexOfLine(lastFrameLines(stdout), "FOOTER")).toBe(8);

    // The content halves. Under a height that tracks its content the footer
    // would jump five rows up the screen mid-run; here it does not move.
    setCount?.(3);
    await settle();
    expect(indexOfLine(lastFrameLines(stdout), "FOOTER")).toBe(8);

    // More content than before still grows the region.
    setCount?.(12);
    await settle();
    expect(indexOfLine(lastFrameLines(stdout), "FOOTER")).toBe(12);

    instance.unmount();
  });

  it("stops at the budget and draws a gutter for what it is holding back", async () => {
    const stdout = new FakeTerminal(40);
    const instance = render(
      React.createElement(ShrinkingRegion, {
        budgetRows: 5,
        initial: 30,
        onReady: () => {},
      }),
      INK_OPTIONS(stdout)
    );

    await settle();
    const lines = lastFrameLines(stdout);
    expect(indexOfLine(lines, "FOOTER")).toBe(5);
    // Tail-pinned: the live end of the content is what survives.
    expect(lines[4]).toContain("row-29");
    expect(lines[0]).not.toContain("row-0");
    // And the gutter says so without spending a row to do it.
    expect(lines.slice(0, 5).join("")).toContain("┃");

    instance.unmount();
  });

  it("gives rows back when the window shrinks under it", async () => {
    const stdout = new FakeTerminal(40);
    const instance = render(
      React.createElement(WindowSizedRegion, { reserveRows: 2, count: 30 }),
      INK_OPTIONS(stdout)
    );
    await settle();
    // Thirty rows of content in a window with room for thirty-eight.
    expect(indexOfLine(lastFrameLines(stdout), "FOOTER")).toBe(30);

    // The one thing that may take height back off a region that never shrinks
    // on its own: the window it lives in getting shorter.
    stdout.resizeTo(12);
    await settle();
    expect(indexOfLine(lastFrameLines(stdout), "FOOTER")).toBe(10);

    // And it re-earns them when the window grows again.
    stdout.resizeTo(40);
    await settle();
    expect(indexOfLine(lastFrameLines(stdout), "FOOTER")).toBe(30);

    instance.unmount();
  });
});

/** A task that owns a handful of children, so the run is bigger than its graph. */
class OwnedLeafTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "OwnedLeafTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute(): Promise<Record<string, never>> {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {};
  }
}

class OwningTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "OwningTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute(
    _input: Record<string, never>,
    context: IExecuteContext
  ): Promise<Record<string, never>> {
    for (let i = 0; i < 4; i++) {
      const child = context.own(new OwnedLeafTask({ title: `Leaf ${i}` }) as never);
      await (child as unknown as OwnedLeafTask).run(undefined, { signal: context.signal });
    }
    return {};
  }
}

async function runWorkflowApp(rows: number): Promise<FakeTerminal> {
  const workflow = new Workflow();
  workflow.pipe(new OwningTask() as never);
  const stdout = new FakeTerminal(rows);
  let finished = false;
  const instance = render(
    React.createElement(WorkflowRunApp, {
      graph: workflow.graph,
      input: {},
      runExecutor: () => workflow.run({}),
      onComplete: () => {
        finished = true;
      },
      onError: () => {
        finished = true;
      },
    }),
    INK_OPTIONS(stdout)
  );

  const deadline = Date.now() + 5000;
  while (!finished && Date.now() < deadline) {
    await settle(50);
  }
  await settle(400);
  instance.unmount();
  return stdout;
}

/** A task that reports progress for long enough to be caught mid-run. */
class ReportingTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "ReportingTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute(
    _input: Record<string, never>,
    context: IExecuteContext
  ): Promise<Record<string, never>> {
    for (let p = 20; p <= 80; p += 20) {
      await context.updateProgress(p, "working");
      await settle(120);
    }
    return {};
  }
}

describe("the run's own progress row", () => {
  it("puts its bar in the same column as the rows beneath it", async () => {
    const workflow = new Workflow();
    workflow.pipe(new ReportingTask({ title: "Reporting task" }) as never);
    const stdout = new FakeTerminal(24);
    const instance = render(
      React.createElement(WorkflowRunApp, {
        graph: workflow.graph,
        input: {},
        runExecutor: () => workflow.run({}),
        onComplete: () => {},
        onError: () => {},
      }),
      INK_OPTIONS(stdout)
    );

    await settle(300);
    const lines = lastFrameLines(stdout);
    const header = lines.find((line) => line.startsWith("Workflow"));
    const row = lines.find((line) => line.includes("Reporting task"));
    instance.unmount();

    expect(header).toBeDefined();
    expect(row).toBeDefined();
    // Left to `justifyContent` alone the header's three children space
    // themselves evenly and its bar drifts to the middle of the window.
    expect(header?.indexOf("▕")).toBe(row?.indexOf("▕"));
    expect(header?.trimEnd().length).toBe(row?.trimEnd().length);
  });
});

/** Owns work and reports nothing of its own — the shape a pipeline step usually has. */
class SilentParentTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "SilentParentTask";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): never {
    return SCHEMA;
  }
  static override outputSchema(): never {
    return SCHEMA;
  }
  override async execute(
    _input: Record<string, never>,
    context: IExecuteContext
  ): Promise<Record<string, never>> {
    const child = context.own(new ReportingTask({ title: "Reporting child" }) as never);
    await (child as unknown as ReportingTask).run(undefined, { signal: context.signal });
    return {};
  }
}

describe("a task that reports no progress of its own", () => {
  it("draws no bar rather than an empty one, and neither does the run", async () => {
    const workflow = new Workflow();
    workflow.pipe(new SilentParentTask({ title: "Silent parent" }) as never);
    const stdout = new FakeTerminal(24);
    const instance = render(
      React.createElement(WorkflowRunApp, {
        graph: workflow.graph,
        input: {},
        runExecutor: () => workflow.run({}),
        onComplete: () => {},
        onError: () => {},
      }),
      INK_OPTIONS(stdout)
    );

    await settle(400);
    const lines = lastFrameLines(stdout);
    const parent = lines.find((line) => line.includes("Silent parent")) ?? "";
    const child = lines.find((line) => line.includes("Reporting child")) ?? "";
    const header = lines.find((line) => line.startsWith("Workflow")) ?? "";
    instance.unmount();

    // The runner stamps `progress = 0` at start without announcing it. Drawn as
    // a determinate bar that is "0% and stuck" above a subtree plainly moving.
    expect(parent).not.toContain("%");
    expect(parent).not.toContain("▕");
    // The child does report, and still draws its bar.
    expect(child).toMatch(/\d+%/);
    // The run's own bar averages those unreported zeroes, so it goes
    // indeterminate rather than claiming a measured nothing.
    expect(header).toContain("░");
    expect(header).not.toContain("0%");
  });
});

describe("resizing", () => {
  it("repaints from a clean screen when the terminal narrows", async () => {
    const workflow = new Workflow();
    workflow.pipe(new OwningTask() as never);
    const stdout = new FakeTerminal(24);
    const instance = render(
      React.createElement(WorkflowRunApp, {
        graph: workflow.graph,
        input: {},
        runExecutor: () => workflow.run({}),
        onComplete: () => {},
        onError: () => {},
      }),
      INK_OPTIONS(stdout)
    );

    await settle(300);
    const before = stdout.frames.length;

    // Height alone reflows nothing, so the screen is left as it is.
    stdout.resizeTo(20);
    await settle(200);
    expect(stdout.frames.slice(before).some((f) => f.includes(ERASE_SCREEN))).toBe(false);

    // Narrowing reflows every line the last frame wrote, which is what strands
    // half of it above the run.
    const beforeNarrow = stdout.frames.length;
    stdout.resizeTo(20, 60);
    await settle(200);
    expect(stdout.frames.slice(beforeNarrow).some((f) => f.includes(ERASE_SCREEN))).toBe(true);
    // Scrollback is the operator's record of the run; a resize does not take it.
    expect(stdout.frames.slice(beforeNarrow).some((f) => f.includes("\u001B[3J"))).toBe(false);

    instance.unmount();
  });
});

describe("the run footer", () => {
  it("counts the tasks a run owns, not only the graph's top level", async () => {
    const stdout = await runWorkflowApp(40);
    const output = stripAnsi(stdout.frames.join("\n"));
    const counts = [...output.matchAll(/(\d+) \/ (\d+) tasks/g)].map((m) => Number(m[2]));
    expect(counts.length).toBeGreaterThan(0);
    // One task in the graph; five in the run once it owns its four children.
    expect(Math.max(...counts)).toBe(5);
    expect(output).toContain("5 / 5 tasks");
  });

  it("never lets the run grow past the window it is drawn in", async () => {
    const stdout = await runWorkflowApp(9);
    for (const frame of stdout.frames) {
      const height = stripAnsi(frame).replace(/\n$/, "").split("\n").length;
      expect(height).toBeLessThanOrEqual(9);
    }
  });
});
