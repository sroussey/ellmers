//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Model, ModelRepository, ModelPrimaryKeySchema } from "ellmers-ai";
import { SqliteKVRepository } from "./base/SqliteKVRepository";

export class SqliteModelRepository extends ModelRepository {
  kvRepository: SqliteKVRepository<unknown, Model, typeof ModelPrimaryKeySchema>;
  public type = "SqliteModelRepository" as const;
  constructor(dbOrPath: string) {
    super();
    this.kvRepository = new SqliteKVRepository<unknown, Model, typeof ModelPrimaryKeySchema>(
      dbOrPath,
      "aimodel",
      ModelPrimaryKeySchema
    );
  }
}
