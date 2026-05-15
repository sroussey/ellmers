/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { setLogger, uuid4 } from "@workglow/util";
import "fake-indexeddb/auto";
import { describe } from "vitest";
import { IndexedDbTaskGraphRepository } from "../../binding/IndexedDbTaskGraphRepository";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericTaskGraphRepositoryTests } from "./genericTaskGraphRepositoryTests";

describe("IndexedDbTaskGraphRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericTaskGraphRepositoryTests(async () => {
    const table = `task_graph_test_${uuid4().replace(/-/g, "_")}`;
    return new IndexedDbTaskGraphRepository(table);
  });
});
