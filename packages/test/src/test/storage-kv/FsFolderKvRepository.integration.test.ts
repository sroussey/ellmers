/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FsFolderKvStorage } from "@workglow/storage";
import { setLogger } from "@workglow/util";
import { mkdirSync, rmSync } from "fs";
import { afterEach, beforeEach, describe } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";

const testDir = ".cache/test/kv-fs-folder";

describe("FsFolderKvStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  beforeEach(() => {
    try {
      mkdirSync(testDir, { recursive: true });
    } catch {}
  });

  afterEach(async () => {
    try {
      rmSync(testDir, { recursive: true });
    } catch {}
  });

  runGenericKvRepositoryTests(async (keyType, valueType) => {
    // Create a deterministic file extension from the schema type
    const schemaType =
      typeof valueType === "object" && valueType !== null && "type" in valueType
        ? String(valueType.type)
        : "data";
    return new FsFolderKvStorage(
      testDir,
      (key) => `${String(key)}.${schemaType}`,
      keyType,
      valueType
    );
  });
});
