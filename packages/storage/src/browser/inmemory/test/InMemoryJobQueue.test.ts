//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { InMemoryJobQueue } from "../InMemoryJobQueue";
import { InMemoryRateLimiter } from "../InMemoryRateLimiter";
import { runGenericJobQueueTests } from "../../../test/genericJobQueueTests";

function createInMemoryJobQueue() {
  return new InMemoryJobQueue("in_memory_test_queue", new InMemoryRateLimiter(4, 1), 0);
}

runGenericJobQueueTests(createInMemoryJobQueue, "InMemoryJobQueue");
