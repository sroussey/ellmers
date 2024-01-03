#!/usr/bin/env bun

import { program } from "commander";
import { argv } from "process";
import { AddSecCommand } from "./src-examples/ExampleSEC";
import { AddSampleCommand } from "./src-examples/SampleText";

program.version("1.0.0").description("A CLI to run Elmers.");

AddSecCommand(program);
AddSampleCommand(program);

await program.parseAsync(argv);
