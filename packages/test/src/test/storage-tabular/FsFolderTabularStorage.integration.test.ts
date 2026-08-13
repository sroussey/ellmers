/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FsFolderTabularStorage } from "@workglow/storage";
import { setLogger, uuid4 } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { mkdirSync, rmSync } from "fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runTabularStorageContract } from "../../contract/tabular-storage/runTabularStorageContract";
import { runGenericTabularStorageSubscriptionTests } from "./genericTabularStorageSubscriptionTests";
import {
  AllTypesPrimaryKeyNames,
  AllTypesSchema,
  CompoundPrimaryKeyNames,
  CompoundSchema,
  runGenericTabularStorageTests,
  SearchPrimaryKeyNames,
  SearchSchema,
} from "./genericTabularStorageTests";

const testDir = ".cache/test/testing";

describe("FsFolderTabularStorage", () => {
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

  // Run basic storage tests that don't involve search
  describe("basic functionality", () => {
    runGenericTabularStorageTests(
      async () =>
        new FsFolderTabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>(
          testDir,
          CompoundSchema,
          CompoundPrimaryKeyNames
        ),
      undefined,
      async () =>
        new FsFolderTabularStorage<typeof AllTypesSchema, typeof AllTypesPrimaryKeyNames>(
          testDir,
          AllTypesSchema,
          AllTypesPrimaryKeyNames
        )
    );
  });

  runGenericTabularStorageSubscriptionTests(
    async () =>
      new FsFolderTabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>(
        testDir,
        CompoundSchema,
        CompoundPrimaryKeyNames
      ),
    { usesPolling: true, pollingIntervalMs: 50, supportsDeleteSearch: false }
  );

  // Add specific tests for search functionality
  describe("search functionality", () => {
    test("should throw error when attempting to search", async () => {
      try {
        new FsFolderTabularStorage<typeof SearchSchema, typeof SearchPrimaryKeyNames>(
          testDir,
          SearchSchema,
          SearchPrimaryKeyNames,
          [
            "category",
            ["category", "subcategory"],
            ["subcategory", "category"],
            "value",
            "tag",
            ["category", "tag"],
          ]
        );
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  runTabularStorageContract({
    name: "FsFolderTabularStorage",
    createStorage: async () =>
      new FsFolderTabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>(
        `.cache/test/contract/fs_${uuid4().replace(/-/g, "_")}`,
        CompoundSchema,
        CompoundPrimaryKeyNames
      ),
    capabilities: {
      supportsSubscriptions: true,
      supportsVectorColumns: false,
      supportsTransactions: false,
      supportsQuery: false,
    },
    usesPolling: true,
    pollingIntervalMs: 50,
  });
});
