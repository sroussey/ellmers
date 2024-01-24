#!/usr/bin/env bun

import { program } from "commander";
import { argv } from "process";
import { AddSecCommands } from "./src-examples/ExampleSEC";
import { AddSampleCommand } from "./src-examples/TaskCLI";

program.version("1.0.0").description("A CLI to run Ellmers.");

AddSecCommands(program);
AddSampleCommand(program);

await program.parseAsync(argv);
