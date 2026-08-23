/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RunRegistry } from "./RunRegistry";

/** A stand-in CLI: reports two events on the fd it was handed, then exits. */
function fakeBinary(dir: string, extra = ""): readonly string[] {
  const script = join(dir, "child.mjs");
  writeFileSync(
    script,
    `import { createWriteStream } from "node:fs";
     const target = process.env.WORKGLOW_RUN_EVENTS ?? "";
     const out = createWriteStream("", { fd: Number(target.slice(3)) });
     out.write(JSON.stringify({ k: "task_added", id: "t1", type: "T", label: process.argv[3], depth: 0 }) + "\\n");
     ${extra}
     out.write(JSON.stringify({ k: "run_end", state: "completed", output: { ok: true } }) + "\\n");
     out.end(() => process.exit(0));`,
    "utf8"
  );
  return [process.execPath, script];
}

function settle(ms = 600): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("RunRegistry", () => {
  it("runs the invocation and buffers its events in order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wg-runs-"));
    const registry = new RunRegistry({ binary: fakeBinary(dir), cwd: dir, logDir: dir });
    const run = registry.start({ path: ["demo"], args: ["hello"], options: {} });
    await settle();
    expect(run.state).toBe("completed");
    // run_start is the registry's own first event, then the child's two.
    expect(run.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(run.events[1].event).toMatchObject({ k: "task_added", label: "hello" });
    registry.closeAll();
  });

  it("persists the stream so a finished run can be read back", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wg-runs-"));
    const registry = new RunRegistry({ binary: fakeBinary(dir), cwd: dir, logDir: dir });
    const run = registry.start({ path: ["demo"], args: ["x"], options: {} });
    await settle();
    const log = readFileSync(join(dir, `${run.id}.ndjson`), "utf8")
      .trim()
      .split("\n");
    expect(log.map((line) => JSON.parse(line).k)).toEqual(["run_start", "task_added", "run_end"]);
    registry.closeAll();
  });

  it("replays what a late subscriber missed and then streams the rest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wg-runs-"));
    const registry = new RunRegistry({ binary: fakeBinary(dir), cwd: dir, logDir: dir });
    const run = registry.start({ path: ["demo"], args: ["x"], options: {} });
    await settle();
    const seen: number[] = [];
    registry.subscribe(run.id, 1, (record) => seen.push(record.seq));
    expect(seen).toEqual([2, 3]);
    registry.closeAll();
  });

  it("bounds what it keeps in memory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wg-runs-"));
    const registry = new RunRegistry({
      binary: fakeBinary(dir),
      cwd: dir,
      logDir: dir,
      maxEvents: 1,
    });
    const run = registry.start({ path: ["demo"], args: ["x"], options: {} });
    await settle();
    expect(run.events).toHaveLength(1);
    expect(run.events[0].event).toMatchObject({ k: "run_end" });
    registry.closeAll();
  });

  it("carries the child's stdout into the stream as log lines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wg-runs-"));
    const registry = new RunRegistry({
      binary: fakeBinary(dir, 'console.log("printed by the command");'),
      cwd: dir,
      logDir: dir,
    });
    const run = registry.start({ path: ["demo"], args: ["x"], options: {} });
    await settle();
    const logs = run.events.flatMap((e) => (e.event.k === "log" ? [e.event.text] : []));
    expect(logs).toContain("printed by the command");
    registry.closeAll();
  });

  it("ends a run whose child died without reporting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wg-runs-"));
    const script = join(dir, "broken.mjs");
    writeFileSync(script, "process.exit(3);", "utf8");
    const registry = new RunRegistry({ binary: [process.execPath, script], cwd: dir, logDir: dir });
    const run = registry.start({ path: ["demo"], args: [], options: {} });
    await settle();
    expect(run.state).toBe("failed");
    expect(run.events.at(-1)!.event).toMatchObject({ k: "run_end", state: "failed" });
    registry.closeAll();
  });
});
