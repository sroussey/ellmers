//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { SqliteTaskOutputRepository } from "../SqliteTaskOutputRepository";
import { runGenericTaskOutputRepositoryTests } from "../../../test/genericTaskOutputRepositoryTests";
import { nanoid } from "nanoid";

runGenericTaskOutputRepositoryTests(
  async () => new SqliteTaskOutputRepository(":memory:", `task_output_test_${nanoid()}`),
  "SqliteTaskOutputRepository"
);
