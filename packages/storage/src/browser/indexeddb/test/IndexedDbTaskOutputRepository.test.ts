//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import "fake-indexeddb/auto";
import { IndexedDbTaskOutputRepository } from "../IndexedDbTaskOutputRepository";
import { runGenericTaskOutputRepositoryTests } from "../../../test/genericTaskOutputRepositoryTests";
import { nanoid } from "nanoid";
import { describe } from "bun:test";

describe("IndexedDbTaskOutputRepository", () => {
  runGenericTaskOutputRepositoryTests(
    async () => new IndexedDbTaskOutputRepository(`idx_test_${nanoid()}`)
  );
});
