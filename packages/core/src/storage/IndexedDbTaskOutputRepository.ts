//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskInput, TaskOutput } from "../task/base/Task";
import { TaskOutputDiscriminator, TaskOutputRepository } from "./TaskOutputRepository";
import { IndexedDbKVRepository } from "./base/IndexedDbKVRepository";

export class IndexedDbTaskOutputRepository extends TaskOutputRepository {
  kvRepository: IndexedDbKVRepository<TaskInput, TaskOutput, typeof TaskOutputDiscriminator>;

  constructor() {
    super();
    this.kvRepository = new IndexedDbKVRepository<
      TaskInput,
      TaskOutput,
      typeof TaskOutputDiscriminator
    >("EllmersDB", "task_outputs");
  }
}
