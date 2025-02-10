//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import "fake-indexeddb/auto";
import { IndexedDbJobQueue } from "../IndexedDbJobQueue";
import { InMemoryRateLimiter } from "../../inmemory/InMemoryRateLimiter";
import { runGenericTaskGraphJobQueueTests } from "../../../test/genericTaskGraphJobQueueTests";
import { TestJob } from "../../../test/genericTaskGraphJobQueueTests";
import { nanoid } from "nanoid";
import { describe } from "bun:test";

describe("IndexedDbTaskGraphJobQueue", () => {
  runGenericTaskGraphJobQueueTests(
    async () =>
      new IndexedDbJobQueue(
        "idx_test",
        `queue_${nanoid()}`,
        new InMemoryRateLimiter(1, 10),
        TestJob,
        10
      )
  );
});
