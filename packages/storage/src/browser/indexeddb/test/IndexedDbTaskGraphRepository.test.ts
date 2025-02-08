//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { IndexedDbTaskGraphRepository } from "../IndexedDbTaskGraphRepository";
import { runGenericTaskGraphRepositoryTests } from "../../../test/genericTaskGraphRepositoryTests";
import "fake-indexeddb/auto";
import { nanoid } from "nanoid";

runGenericTaskGraphRepositoryTests(
  async () => new IndexedDbTaskGraphRepository(`idx_test_${nanoid()}`),
  "IndexedDbTaskGraphRepository"
);
