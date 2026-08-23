/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, HUMAN_CONNECTOR } from "@workglow/util";
import { RunEventHumanConnector } from "./RunEventHumanConnector";
import type { RunEventSink } from "./runEventChannel";
import {
  getRunEventSink,
  installRunEventChannel,
  readRunAnswerLines,
  RUN_ANSWERS_ENV,
  RUN_EVENTS_ENV,
} from "./runEventChannel";

let checked = false;

/**
 * Installs run reporting when a parent process asked for it, once per process.
 *
 * This lives here rather than in one CLI's boot because the claim it supports —
 * that every command in every CLI built on this package is reportable — is only
 * true if a downstream binary gets it too. `sec` has its own entry point and
 * never ran libs' boot, so `sec web` spawned children that reported nothing and
 * the console showed a run with no tasks in it.
 *
 * Idempotent, so a caller that installs early (the web command) and the lazy
 * call on the first run cannot install twice.
 */
export function ensureRunReporting(): RunEventSink | undefined {
  const existing = getRunEventSink();
  if (existing) return existing;
  if (checked) return undefined;
  checked = true;

  const sink = installRunEventChannel(process.env[RUN_EVENTS_ENV] ?? "");
  if (!sink) return undefined;

  // A run that reports over a pipe cannot prompt through a terminal UI, so the
  // connector goes with the channel rather than being wired separately. It
  // opens the answers reader itself, per outstanding question, because a reader
  // held for the whole run keeps the child's event loop alive and the process
  // never exits.
  const answers = process.env[RUN_ANSWERS_ENV] ?? "";
  const connector = new RunEventHumanConnector(sink, (onLine) =>
    readRunAnswerLines(answers, onLine)
  );
  globalServiceRegistry.registerInstance(HUMAN_CONNECTOR, connector);

  // The channel outlives any one graph — a command may run several — so it is
  // flushed when the process ends rather than when a run does. `beforeExit`
  // can still await; by `exit` nothing async can run, so the end() is
  // best-effort there and only matters for a path that skipped beforeExit.
  let closed = false;
  const flush = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await sink.close();
  };
  process.once("beforeExit", () => {
    void flush();
  });
  process.once("exit", () => {
    if (!closed) {
      closed = true;
      void sink.close();
    }
  });

  return sink;
}

/** Test seam: forget that the environment was already read. */
export function resetRunReportingForTesting(): void {
  checked = false;
}
