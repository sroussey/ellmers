/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task, Workflow, type IExecuteContext } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installRunEventChannel,
  resetRunEventChannelForTesting,
  RUN_EVENTS_ENV,
} from "../run-events/runEventChannel";
import { resetRunReportingForTesting } from "../run-events/runReporting";
import { withCli } from "../run-interactive";

const EMPTY = { type: "object", properties: {} } as const satisfies DataPortSchema;

class QuietTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "QuietTask";
  static override readonly title = "Quiet task";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return EMPTY;
  }
  static override outputSchema(): DataPortSchema {
    return EMPTY;
  }
  override async execute(_input: Record<string, never>, context: IExecuteContext) {
    await context.updateProgress(10, "working");
    return {};
  }
}

class ExplodingTask extends Task<Record<string, never>, Record<string, never>> {
  static override readonly type = "ExplodingTask";
  static override readonly title = "Exploding task";
  static override readonly category = "Test";
  static override readonly cacheable = false;
  static override inputSchema(): DataPortSchema {
    return EMPTY;
  }
  static override outputSchema(): DataPortSchema {
    return EMPTY;
  }
  override async execute(): Promise<Record<string, never>> {
    throw new Error("boom");
  }
}

function eventsFrom(file: string): Array<Record<string, unknown>> {
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), "wg-withcli-")), "events.ndjson");
}

afterEach(() => {
  resetRunEventChannelForTesting();
  resetRunReportingForTesting();
  delete process.env[RUN_EVENTS_ENV];
});

describe("withCli with a run event channel", () => {
  it("reports the run without an Ink render", async () => {
    const file = tempFile();
    installRunEventChannel(`file:${file}`);
    const workflow = new Workflow();
    workflow.pipe(new QuietTask() as never);
    await withCli(workflow.graph).run({});
    const kinds = eventsFrom(file).map((e) => e.k);
    expect(kinds).toContain("task_added");
    expect(kinds).toContain("status");
    expect(kinds).toContain("run_end");
    expect(eventsFrom(file).at(-1)).toMatchObject({ k: "run_end", state: "completed" });
  });

  it("reports a failure as the run's end state and still rethrows", async () => {
    const file = tempFile();
    installRunEventChannel(`file:${file}`);
    const workflow = new Workflow();
    workflow.pipe(new ExplodingTask() as never);
    await expect(withCli(workflow.graph).run({})).rejects.toThrow();
    expect(eventsFrom(file).at(-1)).toMatchObject({ k: "run_end", state: "failed" });
  });

  it("installs reporting from the environment, with no boot code of its own", async () => {
    // The claim this whole design rests on is that any CLI built on `withCli`
    // reports when a parent asks. A downstream binary (sec) has its own entry
    // point and never runs this package's boot, so the install cannot live
    // there — it lives in the seam every CLI already reaches its graph through.
    const file = tempFile();
    process.env[RUN_EVENTS_ENV] = `file:${file}`;
    const workflow = new Workflow();
    workflow.pipe(new QuietTask() as never);
    await withCli(workflow.graph).run({});
    const kinds = eventsFrom(file).map((e) => e.k);
    expect(kinds).toContain("task_added");
    expect(kinds).toContain("run_end");
  });

  it("reports even when the caller says not to draw a terminal UI", async () => {
    // A command emitting JSON on stdout must not render Ink, but that says
    // nothing about whether a parent is watching. Conflating the two is what
    // made every piped sec run invisible to the console.
    const file = tempFile();
    installRunEventChannel(`file:${file}`);
    const workflow = new Workflow();
    workflow.pipe(new QuietTask() as never);
    await withCli(workflow.graph, { interactive: false }).run({});
    expect(eventsFrom(file).map((e) => e.k)).toContain("task_added");
  });

  it("reports a single-task run too", async () => {
    const file = tempFile();
    installRunEventChannel(`file:${file}`);
    await withCli(new QuietTask() as never).run({});
    const events = eventsFrom(file);
    expect(events.filter((e) => e.k === "task_added").length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ k: "run_end", state: "completed" });
  });
});
