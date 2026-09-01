/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { closeSync, createReadStream, openSync, read, writeSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
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

/** Resolves a target to a descriptor, and whether we opened it (so must close it). */
function openTarget(target: string): { fd: number; owned: boolean } | undefined {
  if (target.startsWith("fd:")) {
    const fd = Number.parseInt(target.slice(3), 10);
    if (!Number.isInteger(fd) || fd < 0) return undefined;
    return { fd, owned: false };
  }
  if (target.startsWith("file:")) return { fd: openSync(target.slice(5), "a"), owned: true };
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
  let stream: { fd: number; owned: boolean } | undefined;
  try {
    stream = openTarget(target);
  } catch {
    stream = undefined;
  }
  if (!stream) return undefined;
  const { fd, owned } = stream;
  let closed = false;
  const sink: RunEventSink = {
    emit(event) {
      if (closed) return;
      try {
        // Written synchronously, not queued on a stream. The channel now
        // outlives every individual graph, so there is no per-run flush to hide
        // behind — and a buffered line is a line a child that dies never
        // delivers, which is exactly when a watcher most needs the record.
        writeSync(fd, `${JSON.stringify(event)}\n`);
      } catch {
        /* the reader is gone; the run is not */
      }
    },
    close() {
      if (!closed) {
        closed = true;
        // A descriptor the parent handed us belongs to the parent.
        if (owned) {
          try {
            closeSync(fd);
          } catch {
            /* already gone */
          }
        }
      }
      return Promise.resolve();
    },
  };
  installed = sink;
  return sink;
}

/**
 * One long-lived reader per parent-owned descriptor.
 *
 * The descriptor outlives every individual question, so its unfinished line and
 * any line that arrived between questions live here rather than in a per-reader
 * closure — a reader that started fresh each time would drop both.
 */
interface AnswerFdReader {
  readonly listeners: Set<(line: string) => void>;
  /** Holds back a multi-byte character split across two reads. */
  readonly decoder: StringDecoder;
  /** Text decoded but not yet terminated by a newline. */
  partial: string;
  /** Whole lines that arrived while nobody was listening. */
  readonly queued: string[];
  /** A read is outstanding; issuing a second one would interleave the bytes. */
  reading: boolean;
}

const answerFdReaders = new Map<number, AnswerFdReader>();

const ANSWER_CHUNK_BYTES = 64 * 1024;

function deliverAnswerLine(reader: AnswerFdReader, line: string): void {
  if (reader.listeners.size === 0) {
    reader.queued.push(line);
    return;
  }
  for (const listener of [...reader.listeners]) listener(line);
}

/**
 * Issues one read at a time, and only while somebody is waiting on an answer.
 *
 * Stopping between questions is the whole reason this is a loop we drive rather
 * than a stream: the parent holds its end of the pipe for the entire run, so a
 * read left outstanding counts toward the child's event loop and the process
 * never exits — the command finishes in a second and the console waits forever
 * on an exit that never comes. (`unref` is not the way out: a Socket built on
 * the fd unrefs but delivers nothing under Bun.)
 */
function pumpAnswerFd(fd: number, reader: AnswerFdReader): void {
  if (reader.reading || reader.listeners.size === 0) return;
  reader.reading = true;
  const chunk = Buffer.allocUnsafe(ANSWER_CHUNK_BYTES);
  try {
    read(fd, chunk, 0, chunk.length, null, (error, bytesRead) => {
      reader.reading = false;
      // Zero bytes is EOF on a file and a closed writer on a pipe; either way
      // there is nothing more to take until somebody asks again.
      if (error || bytesRead === 0) return;
      reader.partial += reader.decoder.write(chunk.subarray(0, bytesRead));
      let index = reader.partial.indexOf("\n");
      while (index >= 0) {
        deliverAnswerLine(reader, reader.partial.slice(0, index));
        reader.partial = reader.partial.slice(index + 1);
        index = reader.partial.indexOf("\n");
      }
      pumpAnswerFd(fd, reader);
    });
  } catch {
    reader.reading = false;
  }
}

/**
 * Reads NDJSON answer lines from the descriptor the parent named. Returns a
 * stop function, or undefined when nothing is listening.
 *
 * Stop and start it freely: a descriptor the parent handed us belongs to the
 * parent and is never closed here. `fs` read streams close theirs on
 * `destroy()` even with `autoClose: false`, and a closed number is handed
 * straight back to the process — so the next `open()` (a database, a model
 * cache, the log) takes the slot, the next question reads that file instead of
 * the parent's answers, and the release after it closes that subsystem's
 * descriptor. Hence the explicit read loop.
 */
export function readRunAnswerLines(
  target: string,
  onLine: (line: string) => void
): (() => void) | undefined {
  if (!target) return undefined;

  if (target.startsWith("fd:")) {
    const fd = Number.parseInt(target.slice(3), 10);
    if (!Number.isInteger(fd) || fd < 0) return undefined;
    let reader = answerFdReaders.get(fd);
    if (!reader) {
      reader = {
        listeners: new Set(),
        decoder: new StringDecoder("utf8"),
        partial: "",
        queued: [],
        reading: false,
      };
      answerFdReaders.set(fd, reader);
    }
    const active = reader;
    active.listeners.add(onLine);
    while (active.queued.length > 0) onLine(active.queued.shift()!);
    pumpAnswerFd(fd, active);
    return () => {
      active.listeners.delete(onLine);
    };
  }

  // A file we opened ourselves, so the stream owns the descriptor it made.
  if (!target.startsWith("file:")) return undefined;
  let source: ReturnType<typeof createReadStream>;
  try {
    source = createReadStream(target.slice(5), { encoding: "utf8" });
  } catch {
    return undefined;
  }
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

/**
 * Test seam: drops the installed sink so one test file cannot leak into the
 * next. The answer readers go with it — they are keyed by descriptor number,
 * and a test that closes its own fd frees that number for the next test's.
 */
export function resetRunEventChannelForTesting(): void {
  installed = undefined;
  answerFdReaders.clear();
}
