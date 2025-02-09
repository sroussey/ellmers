//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { runGenericJobQueueTests, TestJob } from "../../../test/genericJobQueueTests";
import { SqliteJobQueue } from "../SqliteJobQueue";
import { SqliteRateLimiter } from "../SqliteRateLimiter";
import { getDatabase } from "../../../util/db_sqlite";
import { nanoid } from "nanoid";
import { describe } from "bun:test";

// Create an in-memory database
const db = getDatabase(":memory:");

function createSqliteJobQueue() {
  const queueName = `sqlite_test_queue_${nanoid()}`;
  return new SqliteJobQueue(
    db,
    queueName,
    new SqliteRateLimiter(db, queueName, 4, 1).ensureTableExists(),
    TestJob,
    1
  ).ensureTableExists();
}

describe("SqliteJobQueue", () => {
  runGenericJobQueueTests(createSqliteJobQueue);
});
