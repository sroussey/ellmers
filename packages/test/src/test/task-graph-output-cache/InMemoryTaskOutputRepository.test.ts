/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  InMemoryTaskOutputRepository,
  runTaskOutputRepositoryContract,
} from "@workglow/task-graph/test";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe } from "vitest";

describe("InMemoryTaskOutputRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runTaskOutputRepositoryContract(async () => new InMemoryTaskOutputRepository());
});
