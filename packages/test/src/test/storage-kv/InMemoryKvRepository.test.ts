/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryKvStorage } from "@workglow/storage";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe } from "vitest";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";

describe("InMemoryKvStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  runGenericKvRepositoryTests(
    async (keyType, valueType) => new InMemoryKvStorage(keyType, valueType)
  );
});
