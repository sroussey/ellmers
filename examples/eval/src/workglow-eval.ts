#!/usr/bin/env bun

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { program } from "commander";
import { registerDatasetCommand } from "./commands/dataset";
import { registerReportCommand } from "./commands/report";
import { registerRunCommand } from "./commands/run";
import { loadConfig } from "./config";
import { registerEvalProviders } from "./providers";
import type { EvalStores } from "./storage";
import { createSqliteStores } from "./storage";

const config = loadConfig();
await registerEvalProviders(config);

let stores: Promise<EvalStores> | undefined;
const openStores = (): Promise<EvalStores> => (stores ??= createSqliteStores(config));

program
  .version("2.0.0")
  .description(
    "Workglow eval example — pull HuggingFace datasets into storage, run task workflows " +
      "across models, and score the stored results"
  );

registerDatasetCommand(program, openStores);
registerRunCommand(program, openStores);
registerReportCommand(program, openStores);

await program.parseAsync(process.argv);
// Worker-backed providers keep the event loop alive; exit explicitly.
process.exit(process.exitCode ?? 0);
