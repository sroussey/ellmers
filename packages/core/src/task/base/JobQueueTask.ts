//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { SingleTask, TaskConfig } from "./Task";

/**
 * Configuration interface for job queue tasks
 */
export interface JobQueueTaskConfig extends TaskConfig {
  queue?: string;
  currentJobId?: unknown;
}

/**
 * Base class for job queue tasks
 */
export abstract class JobQueueTask extends SingleTask {
  static readonly type: string = "JobQueueTask";
  declare config: JobQueueTaskConfig & { id: unknown };
  constructor(config: JobQueueTaskConfig) {
    super(config);
  }
}
