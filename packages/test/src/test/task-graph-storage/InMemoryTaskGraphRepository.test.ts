/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { setLogger } from "@workglow/util";
import { describe } from "vitest";
import { InMemoryTaskGraphRepository } from "../../binding/InMemoryTaskGraphRepository";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericTaskGraphRepositoryTests } from "./genericTaskGraphRepositoryTests";

describe("InMemoryTaskGraphRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericTaskGraphRepositoryTests(async () => new InMemoryTaskGraphRepository());
});
