#!/usr/bin/env bun

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerWebCommand } from "@workglow/cli";
import { program } from "commander";
import { registerDatasetCommand } from "./commands/dataset";
import { registerReportCommand } from "./commands/report";
import { registerRunCommand } from "./commands/run";
import { loadConfig } from "./config";
import { registerEvalProviders } from "./providers";
import type { EvalStores } from "./storage";
import { createSqliteStores } from "./storage";

const config = loadConfig();

let stores: Promise<EvalStores> | undefined;
const openStores = (): Promise<EvalStores> => (stores ??= createSqliteStores(config));

// Task/provider registration is only needed by the run-* commands; keeping it
// lazy spares --help and the read-only commands the full model-stack startup.
let providers: Promise<void> | undefined;
const ensureProviders = (): Promise<void> => (providers ??= registerEvalProviders(config));

program
  // Set explicitly rather than left to commander's argv[1] inference: the web
  // console renders it as the command line to run, so a `bun src/…` invocation
  // must still say `workglow-eval`.
  .name("workglow-eval")
  .version("2.0.0")
  .description(
    "Workglow eval example — pull HuggingFace datasets into storage, run task workflows " +
      "across models, and score the stored results"
  );

registerDatasetCommand(program, openStores);
registerRunCommand(program, openStores, ensureProviders);
registerReportCommand(program, openStores);
// The same commands in a browser, over this program's own tree. Registered
// last so the console lists everything above it.
registerWebCommand(program);

await program.parseAsync(process.argv);
// Worker-backed providers keep the event loop alive; exit explicitly.
process.exit(process.exitCode ?? 0);
