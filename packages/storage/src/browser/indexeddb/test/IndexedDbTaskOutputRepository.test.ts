//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { IndexedDbTaskOutputRepository } from "../IndexedDbTaskOutputRepository";
import { runGenericTaskOutputRepositoryTests } from "../../../test/genericTaskOutputRepositoryTests";
import "fake-indexeddb/auto";
import { nanoid } from "nanoid";

runGenericTaskOutputRepositoryTests(
  async () => new IndexedDbTaskOutputRepository(`idx_test_${nanoid()}`),
  "IndexedDbTaskOutputRepository"
);
