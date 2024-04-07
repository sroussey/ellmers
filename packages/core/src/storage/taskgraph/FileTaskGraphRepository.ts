//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphJson } from "../../task/base/TaskGraph";
import { TaskGraphRepository } from "./TaskGraphRepository";
import { FileKVRepository } from "../base/FileKVRepository";

export class FileTaskGraphRepository extends TaskGraphRepository {
  kvRepository: FileKVRepository<unknown, TaskGraphJson>;
  public type = "FileTaskGraphRepository" as const;
  constructor(folderPath: string) {
    super();
    this.kvRepository = new FileKVRepository<unknown, TaskGraphJson>(folderPath);
  }
}
