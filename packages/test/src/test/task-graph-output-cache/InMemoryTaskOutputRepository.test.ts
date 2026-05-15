/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { setLogger } from "@workglow/util";
import { describe } from "vitest";
import { InMemoryTaskOutputRepository } from "../../binding/InMemoryTaskOutputRepository";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericTaskOutputRepositoryTests } from "./genericTaskOutputRepositoryTests";

describe("InMemoryTaskOutputRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericTaskOutputRepositoryTests(async () => new InMemoryTaskOutputRepository());
});
