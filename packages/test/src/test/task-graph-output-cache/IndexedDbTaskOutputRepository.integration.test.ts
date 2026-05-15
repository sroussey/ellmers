/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { setLogger, uuid4 } from "@workglow/util";
import "fake-indexeddb/auto";
import { describe } from "vitest";
import { IndexedDbTaskOutputRepository } from "../../binding/IndexedDbTaskOutputRepository";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericTaskOutputRepositoryTests } from "./genericTaskOutputRepositoryTests";

describe("IndexedDbTaskOutputRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericTaskOutputRepositoryTests(async () => {
    const id = uuid4().replace(/-/g, "_");
    const dbName = `idx_test_${id}`;
    return new IndexedDbTaskOutputRepository(dbName);
  });
});
