#!/usr/bin/env bun

import { program } from "commander";
import { argv } from "process";
import { AddBaseCommands } from "./TaskCLI";

program.version("1.0.0").description("A CLI to run Ellmers.");

AddBaseCommands(program);

await program.parseAsync(argv);
