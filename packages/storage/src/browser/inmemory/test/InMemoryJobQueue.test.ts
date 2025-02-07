//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { InMemoryJobQueue } from "../InMemoryJobQueue";
import { InMemoryRateLimiter } from "../InMemoryRateLimiter";
import { runGenericJobQueueTests, TestJob } from "../../../test/genericJobQueueTests";
import { nanoid } from "nanoid";

function createInMemoryJobQueue() {
  return new InMemoryJobQueue(
    `in_memory_test_queue_${nanoid()}`,
    new InMemoryRateLimiter(4, 1),
    TestJob,
    1
  );
}

runGenericJobQueueTests(createInMemoryJobQueue, "InMemoryJobQueue");
