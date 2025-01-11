#!/usr/bin/env bun

import { program } from "commander";
import { argv } from "process";
import { AddBaseCommands } from "./TaskCLI";
import { getProviderRegistry } from "ellmers-core/server";
import { registerHuggingfaceLocalTasksInMemory } from "ellmers-provider-hf-transformers";
import { registerMediaPipeTfJsLocalInMemory } from "ellmers-provider-tf-mediapipe";

program.version("1.0.0").description("A CLI to run Ellmers.");

AddBaseCommands(program);

registerHuggingfaceLocalTasksInMemory();
registerMediaPipeTfJsLocalInMemory();

await program.parseAsync(argv);

getProviderRegistry().stopQueues();
