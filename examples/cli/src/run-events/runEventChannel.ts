/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import type { RunEvent } from "./RunEventTypes";

export interface RunEventSink {
  emit(event: RunEvent): void;
  /** Resolves once the bytes are flushed — the parent reads what we wrote. */
  close(): Promise<void>;
}

/** Env var a parent process sets to ask its child for a machine-readable run. */
export const RUN_EVENTS_ENV = "WORKGLOW_RUN_EVENTS";

/**
 * Env var naming where answers to the run's human prompts arrive.
 *
 * Its own descriptor rather than stdin: stdin belongs to the command being run,
 * and a run started with stdin closed (`< /dev/null`, a service manager, a CI
 * job) must not die because the answers reader saw EOF.
 */
export const RUN_ANSWERS_ENV = "WORKGLOW_RUN_ANSWERS";

let installed: RunEventSink | undefined;

function openTarget(target: string): WriteStream | undefined {
  if (target.startsWith("fd:")) {
    const fd = Number.parseInt(target.slice(3), 10);
    if (!Number.isInteger(fd) || fd < 0) return undefined;
    return createWriteStream("", { fd });
  }
  if (target.startsWith("file:")) return createWriteStream(target.slice(5), { flags: "a" });
  return undefined;
}

/**
 * Installs the process-wide sink.
 *
 * Every failure here is swallowed: the channel is a reporting side-channel, and
 * a run that would have succeeded must not die because the thing watching it
 * went away — a parent closing a pipe is an ordinary way for that to happen.
 */
export function installRunEventChannel(target: string): RunEventSink | undefined {
  if (!target) return undefined;
  let stream: WriteStream | undefined;
  try {
    stream = openTarget(target);
  } catch {
    stream = undefined;
  }
  if (!stream) return undefined;
  const out = stream;
  out.on("error", () => {});
  const sink: RunEventSink = {
    emit(event) {
      try {
        out.write(`${JSON.stringify(event)}\n`);
      } catch {
        /* the reader is gone; the run is not */
      }
    },
    close() {
      return new Promise<void>((resolve) => {
        try {
          out.end(() => resolve());
        } catch {
          resolve();
        }
      });
    },
  };
  installed = sink;
  return sink;
}

/**
 * Reads NDJSON answer lines from the descriptor the parent named. Returns a
 * stop function, or undefined when nothing is listening.
 */
export function readRunAnswerLines(
  target: string,
  onLine: (line: string) => void
): (() => void) | undefined {
  if (!target) return undefined;
  let stream: ReturnType<typeof createReadStream> | undefined;
  try {
    if (target.startsWith("fd:")) {
      const fd = Number.parseInt(target.slice(3), 10);
      if (!Number.isInteger(fd) || fd < 0) return undefined;
      stream = createReadStream("", { fd, encoding: "utf8" });
    } else if (target.startsWith("file:")) {
      stream = createReadStream(target.slice(5), { encoding: "utf8" });
    }
  } catch {
    return undefined;
  }
  if (!stream) return undefined;
  const source = stream;
  source.on("error", () => {});
  let buffer = "";
  source.on("data", (chunk: string | Buffer) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      onLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  });
  return () => {
    try {
      source.destroy();
    } catch {
      /* already gone */
    }
  };
}

export function getRunEventSink(): RunEventSink | undefined {
  return installed;
}

/** Test seam: drops the installed sink so one test file cannot leak into the next. */
export function resetRunEventChannelForTesting(): void {
  installed = undefined;
}
