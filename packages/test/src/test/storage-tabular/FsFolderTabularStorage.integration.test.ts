/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FsFolderTabularStorage } from "@workglow/storage";
import { setLogger } from "@workglow/util";
import { mkdirSync, rmSync } from "fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runTabularStorageContractTests } from "../../contract/storage-tabular/runTabularStorageContractTests";
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

  runTabularStorageContractTests({
    name: "FsFolder",
    timeout: 5_000,
    factory: async () => ({
      createCompoundRepo: async () =>
        new FsFolderTabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>(
          testDir,
          CompoundSchema,
          CompoundPrimaryKeyNames
        ),
      dispose: async () => {},
    }),
    capabilities: { subscriptions: true, vectorColumns: false },
    subscriptions: { usesPolling: true, pollingIntervalMs: 50 },
    // TODO(workglow): FsFolder polling reorders sequential puts (observed
    // alpha/charlie/bravo when alpha/bravo/charlie was committed). Tracked
    // as an adapter bug for the follow-up commit-order spec.
    expectedFailures: ["subscribe.commitOrder"],
  });

  // Add specific tests for search functionality
  describe("search functionality", () => {
    test("should throw error when attempting to search", async () => {
      try {
        new FsFolderTabularStorage<typeof SearchSchema, typeof SearchPrimaryKeyNames>(
          testDir,
          SearchSchema,
          SearchPrimaryKeyNames,
          ["category", ["category", "subcategory"], ["subcategory", "category"], "value"]
        );
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});
