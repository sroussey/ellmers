/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RunRegistry } from "./RunRegistry";

const HERE = dirname(fileURLToPath(import.meta.url));

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

async function waitFor(done: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done() && Date.now() < deadline) await settle(50);
}

/**
 * A stand-in CLI that asks two questions over fd 4, using the real reader the
 * child ships with — the point of the exercise is that the second reader still
 * has a descriptor to attach to. Node strips the types out of the imported
 * `.ts` source, so the child runs the module under test rather than a copy.
 */
function promptingBinary(dir: string): readonly string[] {
  const script = join(dir, "prompter.mjs");
  const channel = join(HERE, "../run-events/runEventChannel.ts");
  writeFileSync(
    script,
    `import { readRunAnswerLines } from ${JSON.stringify(channel)};
     import { writeSync } from "node:fs";
     const answers = process.env.WORKGLOW_RUN_ANSWERS ?? "";
     const emit = (event) => writeSync(3, JSON.stringify(event) + "\\n");
     function ask(requestId) {
       return new Promise((resolve) => {
         let stop;
         stop = readRunAnswerLines(answers, (line) => {
           const parsed = JSON.parse(line);
           if (parsed.requestId !== requestId) return;
           stop?.();
           resolve(parsed);
         });
         if (!stop) { resolve({ content: "no-reader" }); return; }
         emit({ k: "human_request", requestId, kind: "elicit", message: requestId, schema: undefined, data: undefined });
       });
     }
     const first = await ask("q1");
     emit({ k: "log", level: "info", text: "answered " + first.content });
     const second = await ask("q2");
     emit({ k: "log", level: "info", text: "answered " + second.content });
     emit({ k: "run_end", state: "completed", error: undefined, output: undefined });
     process.exit(0);`,
    "utf8"
  );
  return [process.execPath, script];
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

  /**
   * The prompt after the first one is the interesting one: the child releases
   * its answers reader as soon as a question settles, and the run hangs forever
   * if releasing it took the descriptor down with it.
   */
  it("answers a run that asks twice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wg-runs-"));
    const registry = new RunRegistry({ binary: promptingBinary(dir), cwd: dir, logDir: dir });
    const run = registry.start({ path: ["demo"], args: [], options: {} });

    const delivered: boolean[] = [];
    const asked = new Set<string>();
    registry.subscribe(run.id, 0, (record) => {
      const event = record.event;
      if (event.k !== "human_request" || asked.has(event.requestId)) return;
      asked.add(event.requestId);
      void registry
        .answerHuman(run.id, { requestId: event.requestId, content: `${event.requestId}-ok` })
        .then((ok) => delivered.push(ok));
    });

    await waitFor(() => run.endedAt !== undefined);

    const logs = run.events.flatMap((e) => (e.event.k === "log" ? [e.event.text] : []));
    expect([...asked]).toEqual(["q1", "q2"]);
    expect(logs).toContain("answered q1-ok");
    expect(logs).toContain("answered q2-ok");
    expect(delivered).toEqual([true, true]);
    expect(run.state).toBe("completed");
    registry.closeAll();
  }, 30_000);

  it("reports an answer to a run that already ended as undelivered", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wg-runs-"));
    const registry = new RunRegistry({ binary: fakeBinary(dir), cwd: dir, logDir: dir });
    const run = registry.start({ path: ["demo"], args: ["x"], options: {} });
    await settle();
    expect(await registry.answerHuman(run.id, { requestId: "q1" })).toBe(false);
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
