//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { InMemoryModelRepository } from "../InMemoryModelRepository";
import { runGenericModelRepositoryTests } from "../../../test/genericModelRepositoryTests";
import { describe } from "bun:test";

describe("InMemoryModelRepository", () => {
  runGenericModelRepositoryTests(async () => new InMemoryModelRepository());
});
