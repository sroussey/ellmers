//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { IndexedDbKVRepository } from "../base/IndexedDbKVRepository";
import { runGenericKVRepositoryTests } from "../../../test/genericKVRepositoryTests";
import {
  PrimaryKey,
  Value,
  PrimaryKeySchema,
  ValueSchema,
} from "../../../test/genericKVRepositoryTests";
import { nanoid } from "nanoid";
import { describe } from "bun:test";

describe("IndexedDbKVRepository", () => {
  runGenericKVRepositoryTests(
    async () => new IndexedDbKVRepository(`idx_test_${nanoid()}`),
    async () =>
      new IndexedDbKVRepository<PrimaryKey, Value>(
        `idx_test_${nanoid()}`,
        PrimaryKeySchema,
        ValueSchema
      )
  );
});
