//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { SqliteTaskGraphRepository } from "../SqliteTaskGraphRepository";
import { runGenericTaskGraphRepositoryTests } from "../../../test/genericTaskGraphRepositoryTests";
import { nanoid } from "nanoid";

runGenericTaskGraphRepositoryTests(
  async () => new SqliteTaskGraphRepository(":memory:", `task_graph_test_${nanoid()}`),
  "SqliteTaskGraphRepository"
);
