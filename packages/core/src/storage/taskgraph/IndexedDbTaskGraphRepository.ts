//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphJson } from "../../task/base/TaskGraph";
import { TaskGraphRepository } from "./TaskGraphRepository";
import { IndexedDbKVRepository } from "../base/IndexedDbKVRepository";

export class IndexedDbTaskGraphRepository extends TaskGraphRepository {
  kvRepository: IndexedDbKVRepository<unknown, TaskGraphJson>;

  constructor() {
    super();
    this.kvRepository = new IndexedDbKVRepository<unknown, TaskGraphJson>(
      "EllmersDB",
      "task_graphs"
    );
  }
}
