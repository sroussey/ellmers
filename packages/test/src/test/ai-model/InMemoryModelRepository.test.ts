/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryModelRepository } from "@workglow/ai";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe } from "vitest";
import { runGenericModelRepositoryTests } from "./genericModelRepositoryTests";

describe("InMemoryModelRepository", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericModelRepositoryTests(async () => new InMemoryModelRepository());
});
