//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskInput, TaskOutput } from "../../task/base/Task";
import { TaskOutputDiscriminator, TaskOutputRepository } from "./TaskOutputRepository";
import { InMemoryKVRepository } from "../base/InMemoryKVRepository";

export class InMemoryTaskOutputRepository extends TaskOutputRepository {
  kvRepository: InMemoryKVRepository<TaskInput, TaskOutput, typeof TaskOutputDiscriminator>;

  constructor() {
    super();
    this.kvRepository = new InMemoryKVRepository<
      TaskInput,
      TaskOutput,
      typeof TaskOutputDiscriminator
    >();
  }
}
