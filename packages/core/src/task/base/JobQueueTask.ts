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
  currentJobRunId?: string;
}

/**
 * Configuration interface for job queue tasks with ids
 */
interface JobQueueTaskWithIdsConfig extends JobQueueTaskConfig {
  id: unknown;
}

/**
 * Base class for job queue tasks
 */
export abstract class JobQueueTask extends SingleTask {
  static readonly type: string = "JobQueueTask";
  declare config: JobQueueTaskWithIdsConfig;
  constructor(config: JobQueueTaskConfig) {
    super(config);
  }
}
