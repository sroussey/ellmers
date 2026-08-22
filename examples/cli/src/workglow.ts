#!/usr/bin/env bun

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerAiTasks, setGlobalModelRepository } from "@workglow/ai";
import { registerHuggingFaceTransformers } from "@workglow/huggingface-transformers/ai";
import { registerBaseTasks, registerBuiltInTransforms } from "@workglow/task-graph";
import { registerCommonTasks } from "@workglow/tasks";
import {
  ChainedCredentialStore,
  EnvCredentialStore,
  globalServiceRegistry,
  HUMAN_CONNECTOR,
  setGlobalCredentialStore,
} from "@workglow/util";
import { program } from "commander";
import path from "node:path";
import { registerAgentCommand } from "./commands/agent";
import { registerCredentialCommand } from "./commands/credential";
import { registerInitCommand } from "./commands/init";
import { registerMcpCommand } from "./commands/mcp";
import { registerModelCommand } from "./commands/model";
import { registerTaskCommand } from "./commands/task";
import { registerWorkflowCommand } from "./commands/workflow";
import { loadConfig } from "./config";
import { lazyStore } from "./keyring";
import { RunEventHumanConnector } from "./run-events/RunEventHumanConnector";
import { installRunEventChannel, RUN_EVENTS_ENV } from "./run-events/runEventChannel";
import { seedSamplesIfRepoEmpty } from "./samples/chatSample";
import { createModelRepository, createWorkflowRepository } from "./storage";
import { detectCliTheme, setCliTheme } from "./terminal/detectTerminalTheme";
import { InkHumanConnector } from "./ui/InkHumanConnector";

// Register all task types so TaskRegistry is populated
registerBaseTasks();
registerCommonTasks();
registerAiTasks();
registerBuiltInTransforms();

// Set up global credential store: lazy encrypted store (unlocked on demand) + env var fallback.
// The lazyStore starts locked; ensureCredentialStoreUnlocked() is called before operations
// that need encrypted credentials (workflow run, credential add, etc.).
setGlobalCredentialStore(new ChainedCredentialStore([lazyStore, new EnvCredentialStore()]));

/**
 * A parent process asking for a machine-readable run gets one: the channel is
 * installed before anything can run, and the human connector answers over it
 * rather than trying to render a prompt into a pipe.
 */
const runEventSink = installRunEventChannel(process.env[RUN_EVENTS_ENV] ?? "");
if (runEventSink) {
  const connector = new RunEventHumanConnector(runEventSink);
  globalServiceRegistry.registerInstance(HUMAN_CONNECTOR, connector);
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      connector.feedHumanResponseLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  });
} else {
  globalServiceRegistry.registerInstance(HUMAN_CONNECTOR, new InkHumanConnector());
}

// Set up global model repository backed by filesystem
const config = await loadConfig();
setCliTheme(await detectCliTheme());
const modelRepo = createModelRepository(config);
await modelRepo.setupDatabase();
setGlobalModelRepository(modelRepo);

// Seed the chat sample workflow on first run (idempotent; only seeds if the repo is empty)
const workflowRepo = createWorkflowRepository(config);
await workflowRepo.setupDatabase();
await seedSamplesIfRepoEmpty(workflowRepo);

// Expose model cache path to the HFT worker via env var
process.env.WORKGLOW_MODEL_CACHE = path.join(config.directories.cache, "onnx");

await registerHuggingFaceTransformers({
  // ".js" resolves in both modes: bun maps it to worker_hft.ts when running
  // from source, and the built dist contains worker_hft.js (a ".ts" specifier
  // would fail in dist — bun build does not rewrite worker URLs).
  worker: () => new Worker(new URL("./worker_hft.js", import.meta.url), { type: "module" }),
});

program.version("2.0.0").description("Workglow CLI — manage models, workflows, agents, and tasks");

registerInitCommand(program);
registerModelCommand(program);
registerMcpCommand(program);
registerWorkflowCommand(program);
registerAgentCommand(program);
registerCredentialCommand(program);
registerTaskCommand(program);

await program.parseAsync(process.argv);
process.exit(0);
