//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { SingleTask, TaskInput } from "./Task";

/**
 * A task class that handles array-based processing by creating subtasks for each combination of inputs
 * Extends RegenerativeCompoundTask to manage a collection of child tasks running in parallel
 */
export class OutputTask extends SingleTask {
  static readonly category = "Output";
  provenance: TaskInput = {};
  static readonly sideeffects = true;
  async run(provenance: TaskInput = {}) {
    this.provenance = provenance;
    return super.run();
  }
}
