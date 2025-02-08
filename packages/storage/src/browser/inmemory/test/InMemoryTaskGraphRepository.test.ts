//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { InMemoryTaskGraphRepository } from "../InMemoryTaskGraphRepository";
import { runGenericTaskGraphRepositoryTests } from "../../../test/genericTaskGraphRepositoryTests";

runGenericTaskGraphRepositoryTests(
  async () => new InMemoryTaskGraphRepository(),
  "InMemoryTaskGraphRepository"
);
