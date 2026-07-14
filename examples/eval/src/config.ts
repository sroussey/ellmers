/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface EvalConfig {
  /** Directory holding the SQLite database and model cache. */
  readonly home: string;
  /** SQLite database file with dataset rows, runs, and results. */
  readonly dbPath: string;
  /** ONNX model cache directory for the HuggingFace Transformers worker. */
  readonly modelCache: string;
  /** GGUF weights directory for the node-llama-cpp worker. */
  readonly ggufCache: string;
}

/** The eval home directory (no side effects; safe to call from pure helpers). */
export function evalHome(): string {
  return process.env.WORKGLOW_EVAL_HOME ?? join(homedir(), ".workglow", "eval");
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
    ggufCache: join(home, "cache", "gguf"),
  };
}
