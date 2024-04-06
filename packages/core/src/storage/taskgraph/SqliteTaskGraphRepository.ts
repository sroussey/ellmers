//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphJson } from "../../task/base/TaskGraph";
import { TaskGraphRepository } from "./TaskGraphRepository";
import { SqliteKVRepository } from "../base/SqliteKVRepository";

export class SqliteTaskGraphRepository extends TaskGraphRepository {
  kvRepository: SqliteKVRepository<unknown, TaskGraphJson>;
  constructor(dbOrPath: string) {
    super();
    this.kvRepository = new SqliteKVRepository<unknown, TaskGraphJson>(dbOrPath, "task_graphs");
  }
}
