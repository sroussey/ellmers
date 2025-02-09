//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { IndexedDbJobQueue } from "../IndexedDbJobQueue";
import { InMemoryRateLimiter } from "../../inmemory/InMemoryRateLimiter";
import { runGenericTaskGraphJobQueueTests } from "../../../test/genericTaskGraphJobQueueTests";
import { TestJob } from "../../../test/genericTaskGraphJobQueueTests";
import "fake-indexeddb/auto";
import { nanoid } from "nanoid";
import { describe } from "bun:test";

describe("IndexedDbTaskGraphJobQueue", () => {
  runGenericTaskGraphJobQueueTests(async () => {
    const queue = new IndexedDbJobQueue(
      "idx_test",
      `queue_${nanoid()}`,
      new InMemoryRateLimiter(1, 10),
      TestJob,
      10
    );
    // Wait for the database to be initialized
    await new Promise((resolve) => setTimeout(resolve, 100));
    return queue;
  }, "IndexedDbTaskGraphJobQueue");
});
