//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskInput, TaskOutput, TaskOutputDiscriminator, TaskOutputRepository } from "ellmers-core";
import { InMemoryKVRepository } from "./InMemoryKVRepository";

export class InMemoryTaskOutputRepository extends TaskOutputRepository {
  kvRepository: InMemoryKVRepository<TaskInput, TaskOutput, typeof TaskOutputDiscriminator>;
  public type = "InMemoryTaskOutputRepository" as const;
  constructor() {
    super();
    this.kvRepository = new InMemoryKVRepository<
      TaskInput,
      TaskOutput,
      typeof TaskOutputDiscriminator
    >();
  }
}
