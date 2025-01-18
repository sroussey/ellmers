//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskGraphRepository } from "ellmers-core";
import { FileKVRepository } from "./base/FileKVRepository";

/**
 * File-based implementation of a task graph repository.
 * Provides storage and retrieval for task graphs using a file system.
 */
export class FileTaskGraphRepository extends TaskGraphRepository {
  kvRepository: FileKVRepository;
  public type = "FileTaskGraphRepository" as const;
  constructor(folderPath: string) {
    super();
    this.kvRepository = new FileKVRepository(folderPath);
  }
}
