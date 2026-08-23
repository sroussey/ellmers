/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { RunEvent } from "../run-events/RunEventTypes";
import { RUN_ANSWERS_ENV, RUN_EVENTS_ENV } from "../run-events/runEventChannel";
import type { RunState } from "../ui/model/runRowModel";
import { composeArgv, renderCliLine, type WebInvocation } from "./argv";

export interface RunEventRecord {
  readonly seq: number;
  readonly event: RunEvent;
}

export interface WebRun {
  readonly id: string;
  readonly cli: string;
  readonly invocation: WebInvocation;
  readonly startedAt: number;
  state: "running" | RunState;
  endedAt: number | undefined;
  exitCode: number | undefined;
  readonly events: RunEventRecord[];
}

export interface RunRegistryOptions {
  /** How to start the CLI, e.g. `["bun", "/path/to/workglow.ts"]`. */
  readonly binary: readonly string[];
  readonly cwd: string;
  readonly logDir: string;
  readonly binaryName?: string;
  /** Events retained in memory per run; the log on disk keeps everything. */
  readonly maxEvents?: number;
}

const DEFAULT_MAX_EVENTS = 5000;

type Listener = (record: RunEventRecord) => void;

/**
 * Whether a child is still running.
 *
 * `exitCode` alone is not the test: a process killed by a signal — which is
 * exactly what `abort` does — reports `exitCode === null` and `signalCode` set,
 * forever, so an `exitCode`-only check calls a killed run alive.
 */
function isAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Runs each invocation as a child of the same binary.
 *
 * A child rather than an in-process call, for three reasons that all showed up
 * in practice: the argv is exactly the line the page shows, so what you read is
 * what ran; cancellation is SIGINT, which every task already handles; and an
 * env-var model override belongs to one run instead of to the server, so two
 * runs cannot observe each other's.
 */
export class RunRegistry {
  private readonly runs = new Map<string, WebRun>();
  private readonly children = new Map<string, ChildProcess>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly logs = new Map<string, WriteStream>();
  private readonly maxEvents: number;

  constructor(private readonly options: RunRegistryOptions) {
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
    mkdirSync(options.logDir, { recursive: true });
  }

  start(invocation: WebInvocation): WebRun {
    const id = randomUUID();
    const run: WebRun = {
      id,
      cli: renderCliLine(this.options.binaryName ?? "workglow", invocation),
      invocation,
      startedAt: Date.now(),
      state: "running",
      endedAt: undefined,
      exitCode: undefined,
      events: [],
    };
    this.runs.set(id, run);
    this.logs.set(id, createWriteStream(join(this.options.logDir, `${id}.ndjson`), { flags: "a" }));

    const [command, ...prefix] = this.options.binary;
    const child = spawn(command, [...prefix, ...composeArgv(invocation)], {
      cwd: this.options.cwd,
      env: {
        ...process.env,
        [RUN_EVENTS_ENV]: "fd:3",
        [RUN_ANSWERS_ENV]: "fd:4",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
    });
    this.children.set(id, child);

    // Writing to a pipe whose reader has exited emits EPIPE, and an unhandled
    // `error` event on a stream is thrown. Nothing else listens to this one.
    (child.stdio[4] as Writable | undefined)?.on("error", () => {});

    this.record(run, { k: "run_start", cli: run.cli, at: run.startedAt });
    this.readEvents(run, child);
    this.readLogs(run, child.stdout, "info");
    this.readLogs(run, child.stderr, "error");

    child.on("error", (error) => {
      this.record(run, { k: "log", level: "error", text: error.message });
      this.finish(run, "failed", undefined);
    });
    child.on("close", (code) => this.finish(run, undefined, code ?? undefined));
    return run;
  }

  get(id: string): WebRun | undefined {
    return this.runs.get(id);
  }

  list(): readonly WebRun[] {
    return [...this.runs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  /**
   * Asks the run to stop the way Ctrl-C does, then insists. A task graph
   * cancels cooperatively, so the polite signal is the one that leaves the
   * database and the caches consistent.
   */
  abort(id: string): boolean {
    const child = this.children.get(id);
    if (!child || !isAlive(child)) return false;
    child.kill("SIGINT");
    setTimeout(() => {
      if (isAlive(child)) child.kill("SIGKILL");
    }, 5000).unref?.();
    return true;
  }

  answerHuman(id: string, response: unknown): boolean {
    const child = this.children.get(id);
    if (!child || !isAlive(child)) return false;
    const answers = child.stdio[4] as Writable | undefined;
    if (!answers || answers.destroyed) return false;
    // The child can still exit between the liveness check and the write, and
    // an EPIPE arrives as an `error` event on a stream nobody listens to —
    // which Node throws, taking the whole console down because someone
    // answered a prompt a moment too late. (`start` installs the listener.)
    try {
      answers.write(`${JSON.stringify(response)}\n`);
    } catch {
      return false;
    }
    return true;
  }

  /** Replays what the subscriber missed, then streams the rest. */
  subscribe(id: string, afterSeq: number, listener: Listener): () => void {
    const run = this.runs.get(id);
    if (!run) return () => {};
    for (const record of run.events) {
      if (record.seq > afterSeq) listener(record);
    }
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      // A page that closed its stream leaves nothing behind: the map is keyed
      // by run and a `web` server outlives thousands of them.
      if (set!.size === 0) this.listeners.delete(id);
    };
  }

  closeAll(): void {
    for (const child of this.children.values()) {
      if (isAlive(child)) child.kill("SIGKILL");
    }
    for (const log of this.logs.values()) log.end();
  }

  private nextSeq(run: WebRun): number {
    const last = run.events.at(-1);
    return (last?.seq ?? 0) + 1;
  }

  private record(run: WebRun, event: RunEvent): void {
    const record: RunEventRecord = { seq: this.nextSeq(run), event };
    run.events.push(record);
    if (run.events.length > this.maxEvents)
      run.events.splice(0, run.events.length - this.maxEvents);
    this.logs.get(run.id)?.write(`${JSON.stringify(event)}\n`);
    for (const listener of this.listeners.get(run.id) ?? []) listener(record);
  }

  private readEvents(run: WebRun, child: ChildProcess): void {
    const stream = child.stdio[3] as Readable | undefined;
    if (!stream) return;
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string | Buffer) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        if (!line) continue;
        try {
          const event = JSON.parse(line) as RunEvent;
          if (event.k === "run_end") {
            this.record(run, event);
            run.state = event.state === "" ? "completed" : event.state;
          } else {
            this.record(run, event);
          }
        } catch {
          /* a partial or corrupt line is not worth failing the run over */
        }
      }
    });
    stream.on("error", () => {});
  }

  private readLogs(run: WebRun, stream: unknown, level: "info" | "error"): void {
    const readable = stream as { on?: (event: string, cb: (chunk: Buffer) => void) => void };
    readable?.on?.("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").replace(/\s+$/, "");
      if (text) this.record(run, { k: "log", level, text });
    });
  }

  /**
   * A child that dies before reporting still has to end the page's spinner, so
   * a missing `run_end` is synthesized from the exit code rather than left for
   * the client to time out on.
   */
  private finish(run: WebRun, state: RunState | undefined, code: number | undefined): void {
    if (run.endedAt !== undefined) return;
    run.endedAt = Date.now();
    run.exitCode = code;
    const reported = run.events.some((record) => record.event.k === "run_end");
    if (!reported) {
      const resolved: RunState = state ?? (code === 0 ? "completed" : "failed");
      this.record(run, {
        k: "run_end",
        state: resolved,
        error: code === 0 ? undefined : `exited with code ${code ?? "unknown"}`,
        output: undefined,
      });
      run.state = resolved;
    } else if (run.state === "running") {
      run.state = code === 0 ? "completed" : "failed";
    }
    this.logs.get(run.id)?.end();
    this.logs.delete(run.id);
    this.children.delete(run.id);
  }
}
