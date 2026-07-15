/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface EvalConfig {
  /** Directory holding the SQLite database and model cache. */
  readonly home: string;
  /** SQLite database file with dataset rows, runs, and results. */
  readonly dbPath: string;
  /** ONNX model cache directory for the HuggingFace Transformers worker. */
  readonly modelCache: string;
}

/**
 * The eval home directory (no side effects; safe to call from pure helpers).
 * WORKGLOW_EVAL_HOME is set by the invoking user for their own machine — the
 * same trust domain as the process itself, like HOME or XDG_DATA_HOME — and is
 * normalized to an absolute path so a relative value anchors predictably.
 */
export function evalHome(): string {
  const override = process.env.WORKGLOW_EVAL_HOME;
  return override ? resolve(override) : join(homedir(), ".workglow", "eval");
}

/** GGUF weights directory for the node-llama-cpp worker (used by the model resolver). */
export function ggufCacheDir(): string {
  return join(evalHome(), "cache", "gguf");
}

/**
 * Resolve the eval home directory. Everything the harness persists (dataset
 * rows, eval runs, per-row results, downloaded local models) lives under this
 * one directory so it is easy to inspect and easy to delete.
 */
export function loadConfig(): EvalConfig {
  const home = evalHome();
  mkdirSync(home, { recursive: true });
  return {
    home,
    dbPath: join(home, "eval.sqlite"),
    modelCache: join(home, "cache", "onnx"),
  };
}
