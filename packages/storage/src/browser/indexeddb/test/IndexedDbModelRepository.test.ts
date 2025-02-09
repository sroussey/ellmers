//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import "fake-indexeddb/auto";
import { IndexedDbModelRepository } from "../IndexedDbModelRepository";
import { runGenericModelRepositoryTests } from "../../../test/genericModelRepositoryTests";
import { nanoid } from "nanoid";
import { describe } from "bun:test";
// TODO: fix this test, it requires search on KVRepository, which is not implemented yet

describe("IndexedDbModelRepository", () => {
  // runGenericModelRepositoryTests(
  //   async () =>
  //     new IndexedDbModelRepository(`idx_model_test_${nanoid()}`, `idx_task2model_test_${nanoid()}`)
  // );
});
