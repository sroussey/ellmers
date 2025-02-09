//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { InMemoryTaskGraphRepository } from "../InMemoryTaskGraphRepository";
import { runGenericTaskGraphRepositoryTests } from "../../../test/genericTaskGraphRepositoryTests";
import { describe } from "bun:test";

describe("InMemoryTaskGraphRepository", () => {
  runGenericTaskGraphRepositoryTests(async () => new InMemoryTaskGraphRepository());
});
