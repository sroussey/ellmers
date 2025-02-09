//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { InMemoryKVRepository } from "../base/InMemoryKVRepository";
import { runGenericKVRepositoryTests } from "../../../test/genericKVRepositoryTests";
import {
  PrimaryKey,
  Value,
  PrimaryKeySchema,
  ValueSchema,
} from "../../../test/genericKVRepositoryTests";
import { describe } from "bun:test";

describe("InMemoryKVRepository", () => {
  runGenericKVRepositoryTests(
    async () => new InMemoryKVRepository(),
    async () => new InMemoryKVRepository<PrimaryKey, Value>(PrimaryKeySchema, ValueSchema)
  );
});
