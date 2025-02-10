//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { InMemoryJobQueue } from "../InMemoryJobQueue";
import { ConcurrencyLimiter } from "@ellmers/job-queue";
import { runGenericTaskGraphJobQueueTests } from "../../../test/genericTaskGraphJobQueueTests";
import { TestJob } from "../../../test/genericTaskGraphJobQueueTests";
import { describe } from "bun:test";

describe("InMemoryTaskGraphJobQueue", () => {
  runGenericTaskGraphJobQueueTests(
    async () => new InMemoryJobQueue("inMemory", new ConcurrencyLimiter(1, 10), TestJob, 10)
  );
});
