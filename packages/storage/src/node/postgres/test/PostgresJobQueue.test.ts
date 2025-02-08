//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { InMemoryRateLimiter } from "../../../browser/inmemory";
import { runGenericJobQueueTests, TestJob } from "../../../test/genericJobQueueTests";
import { PostgresJobQueue } from "../PostgresJobQueue";
import { PostgresRateLimiter } from "../PostgresRateLimiter";
import { nanoid } from "nanoid";
import { newDb } from "pg-mem";

// Create an in-memory database
const db = newDb();
const sql = db.adapters.createPostgresJsTag() as import("postgres").Sql;

async function createPostgresJobQueue() {
  const queueName = `postgres_test_queue_${nanoid()}`;
  const queue = new PostgresJobQueue(
    sql,
    queueName,
    new InMemoryRateLimiter(4, 1), // new PostgresRateLimiter(sql, queueName, 4, 1).ensureTableExists(),
    TestJob,
    1
  );
  await queue.ensureTableExists(); // This will run async but we return the queue immediately
  return queue;
}

runGenericJobQueueTests(createPostgresJobQueue, "PostgresJobQueue");
