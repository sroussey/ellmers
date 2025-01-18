#!/usr/bin/env bun

import { program } from "commander";
import { argv } from "process";
import { AddBaseCommands } from "./TaskCLI";
import { getProviderRegistry } from "ellmers-ai";
import {
  registerHuggingfaceLocalModels,
  registerHuggingfaceLocalTasksInMemory,
  registerMediaPipeTfJsLocalInMemory,
  registerMediaPipeTfJsLocalModels,
} from "ellmers-test";
import "ellmers-test";

program.version("1.0.0").description("A CLI to run Ellmers.");

AddBaseCommands(program);

await registerHuggingfaceLocalModels();
await registerMediaPipeTfJsLocalModels();

registerHuggingfaceLocalTasksInMemory();
registerMediaPipeTfJsLocalInMemory();

await program.parseAsync(argv);

getProviderRegistry().stopQueues();
