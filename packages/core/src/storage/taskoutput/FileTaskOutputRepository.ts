//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskInput, TaskOutput } from "../../task/base/Task";
import { TaskOutputDiscriminator, TaskOutputRepository } from "./TaskOutputRepository";
import { FileKVRepository } from "../base/FileKVRepository";

export class FileTaskOutputRepository extends TaskOutputRepository {
  kvRepository: FileKVRepository<TaskInput, TaskOutput, typeof TaskOutputDiscriminator>;
  public type = "FileTaskOutputRepository" as const;
  constructor(folderPath: string) {
    super();
    this.kvRepository = new FileKVRepository<TaskInput, TaskOutput, typeof TaskOutputDiscriminator>(
      folderPath,
      TaskOutputDiscriminator
    );
  }
}
