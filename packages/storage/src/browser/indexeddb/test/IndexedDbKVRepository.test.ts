//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import "fake-indexeddb/auto";
import { IndexedDbKVRepository } from "../base/IndexedDbKVRepository";
import { runGenericKVRepositoryTests } from "../../../test/genericKVRepositoryTests";
import {
  PrimaryKey,
  Value,
  PrimaryKeySchema,
  ValueSchema,
} from "../../../test/genericKVRepositoryTests";
import { nanoid } from "nanoid";
import { afterAll, describe } from "bun:test";

describe("IndexedDbKVRepository", () => {
  const dbName = `idx_test_${nanoid()}`;
  runGenericKVRepositoryTests(
    async () => new IndexedDbKVRepository(`${dbName}_simple`),
    async () =>
      new IndexedDbKVRepository<PrimaryKey, Value>(
        `${dbName}_complex`,
        PrimaryKeySchema,
        ValueSchema
      )
  );
  afterAll(() => {
    // indexedDB.deleteDatabase(`${dbName}_simple`);
    // indexedDB.deleteDatabase(`${dbName}_complex`);
  });
});
