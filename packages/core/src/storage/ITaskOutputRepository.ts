//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskInput, TaskOutput } from "task";

export interface ITaskOutputRepository {
  saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput): Promise<void>;
  getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined>;
}
