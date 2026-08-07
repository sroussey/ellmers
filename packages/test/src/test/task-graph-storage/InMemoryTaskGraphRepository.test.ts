/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  InMemoryTaskGraphRepository,
  runTaskGraphRepositoryContract,
} from "@workglow/task-graph/test";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe } from "vitest";

describe("InMemoryTaskGraphRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runTaskGraphRepositoryContract(async () => new InMemoryTaskGraphRepository());
});
