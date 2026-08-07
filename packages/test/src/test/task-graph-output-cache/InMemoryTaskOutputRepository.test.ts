/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTaskOutputRepository } from "@workglow/task-graph/test";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe } from "vitest";
import { runGenericTaskOutputRepositoryTests } from "./genericTaskOutputRepositoryTests";

describe("InMemoryTaskOutputRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericTaskOutputRepositoryTests(async () => new InMemoryTaskOutputRepository());
});
