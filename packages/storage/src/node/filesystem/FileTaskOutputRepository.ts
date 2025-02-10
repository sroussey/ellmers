//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  DefaultValueType,
  TaskOutputPrimaryKey,
  TaskOutputPrimaryKeySchema,
  TaskOutputRepository,
} from "@ellmers/task-graph";
import { FileKVRepository } from "./base/FileKVRepository";

/**
 * File-based implementation of a task output repository.
 * Provides storage and retrieval for task outputs using a file system.
 */
export class FileTaskOutputRepository extends TaskOutputRepository {
  kvRepository: FileKVRepository<
    TaskOutputPrimaryKey,
    DefaultValueType,
    typeof TaskOutputPrimaryKeySchema
  >;
  public type = "FileTaskOutputRepository" as const;
  constructor(folderPath: string) {
    super();
    this.kvRepository = new FileKVRepository<
      TaskOutputPrimaryKey,
      DefaultValueType,
      typeof TaskOutputPrimaryKeySchema
    >(folderPath, TaskOutputPrimaryKeySchema);
  }
}
