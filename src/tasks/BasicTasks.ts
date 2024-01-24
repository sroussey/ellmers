//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskConfig, Task, TaskInput } from "#/Task";

export interface RenameTaskInput {
  output_remap_array: {
    from: string;
    to: string;
  }[];
}

/**
 * Uses config to map multiple values from inputs to outputs
 */
export class RenameTask extends Task {
  readonly type: string = "RenameTask";
  constructor(
    config: TaskConfig = {},
    defaults: RenameTaskInput = { output_remap_array: [] }
  ) {
    config.name ||=
      "RenameTask" +
      (defaults?.output_remap_array?.length
        ? defaults?.output_remap_array
            .map(({ from, to }) => `: from ${from} to ${to}`)
            .join(", ")
        : "");
    super(config, defaults);
  }
  async run(overrides?: RenameTaskInput) {
    this.emit("start");
    this.input = this.withDefaults(overrides);
    this.output = {};
    for (const { from, to } of this.input.output_remap_array) {
      if (from != "output_remap_array") {
        this.output[to] = this.input[from];
      }
    }
    this.emit("complete");
    return this.output;
  }
}

// ===============================================================================

export class LambdaTask extends Task {
  #runner: (input: TaskInput) => Promise<TaskInput>;
  readonly type: string = "LambdaTask";
  constructor(
    config: TaskConfig & {
      run: () => Promise<TaskInput>;
    },
    defaults: TaskInput = {}
  ) {
    super(config, defaults);
    this.#runner = config.run;
  }
  async run(overrides?: TaskInput) {
    this.emit("start");
    this.input = this.withDefaults<TaskInput>(overrides);
    this.output = await this.#runner(this.input);
    this.emit("complete");
    return this.output;
  }
}
