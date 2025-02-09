//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { InMemoryTaskOutputRepository } from "../InMemoryTaskOutputRepository";
import { runGenericTaskOutputRepositoryTests } from "../../../test/genericTaskOutputRepositoryTests";
import { describe } from "bun:test";

describe("InMemoryTaskOutputRepository", () => {
  runGenericTaskOutputRepositoryTests(async () => new InMemoryTaskOutputRepository());
});
