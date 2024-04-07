//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphJson } from "../../task/base/TaskGraph";
import { TaskGraphRepository } from "./TaskGraphRepository";
import { InMemoryKVRepository } from "../base/InMemoryKVRepository";

export class InMemoryTaskGraphRepository extends TaskGraphRepository {
  kvRepository: InMemoryKVRepository<unknown, TaskGraphJson>;
  public type = "InMemoryTaskGraphRepository" as const;
  constructor() {
    super();
    this.kvRepository = new InMemoryKVRepository<unknown, TaskGraphJson>();
  }
}
