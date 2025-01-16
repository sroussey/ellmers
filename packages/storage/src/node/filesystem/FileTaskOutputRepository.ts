//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  DefaultValueType,
  TaskInput,
  TaskOutputPrimaryKey,
  TaskOutputPrimaryKeySchema,
  TaskOutputRepository,
} from "ellmers-core";
import { FileKVRepository } from "./base/FileKVRepository";

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
