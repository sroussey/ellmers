//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskOutput, TaskInput } from "ellmers-core";
import { IndexedDbJobQueue } from "../IndexedDbJobQueue";
import { InMemoryRateLimiter } from "../../inmemory/InMemoryRateLimiter";
import { runGenericJobQueueTests, TestJob } from "../../../test/genericJobQueueTests";
import "fake-indexeddb/auto";

function createIndexedDbJobQueue() {
  return new IndexedDbJobQueue<TaskInput, TaskOutput>(
    `indexeddb_test_queue_${Date.now()}`,
    new InMemoryRateLimiter(4, 1),
    TestJob,
    1
  );
}

runGenericJobQueueTests(createIndexedDbJobQueue, "IndexedDbJobQueue");
