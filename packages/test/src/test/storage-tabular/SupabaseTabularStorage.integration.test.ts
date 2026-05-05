/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SupabaseTabularStorage } from "@workglow/supabase/storage";
import { setLogger, uuid4 } from "@workglow/util";
import { afterAll, describe } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";
import { runTabularStorageContractTests } from "../../contract/storage-tabular/runTabularStorageContractTests";
import { createSupabaseMockClient } from "../helpers/SupabaseMockClient";
import {
  AllTypesPrimaryKeyNames,
  AllTypesSchema,
  CompoundPrimaryKeyNames,
  CompoundSchema,
  runGenericTabularStorageTests,
  SearchPrimaryKeyNames,
  SearchSchema,
} from "./genericTabularStorageTests";

const client = createSupabaseMockClient();

describe("SupabaseTabularStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);

  afterAll(async () => {
    await client.close();
  });

  runGenericTabularStorageTests(
    async () =>
      new SupabaseTabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>(
        client,
        `supabase_test_${uuid4().replace(/-/g, "_")}`,
        CompoundSchema,
        CompoundPrimaryKeyNames
      ),
    async () =>
      new SupabaseTabularStorage<typeof SearchSchema, typeof SearchPrimaryKeyNames>(
        client,
        `supabase_test_${uuid4().replace(/-/g, "_")}`,
        SearchSchema,
        SearchPrimaryKeyNames,
        ["category", ["category", "subcategory"], ["subcategory", "category"], "value"]
      ),
    async () => {
      const repo = new SupabaseTabularStorage<
        typeof AllTypesSchema,
        typeof AllTypesPrimaryKeyNames
      >(
        client,
        `supabase_test_${uuid4().replace(/-/g, "_")}`,
        AllTypesSchema,
        AllTypesPrimaryKeyNames
      );
      await repo.setupDatabase();
      return repo;
    }
  );

  // Subscription tests skipped for Supabase because mock client doesn't support realtime
  // In production, Supabase uses realtime subscriptions which require a real Supabase instance

  runTabularStorageContractTests({
    name: "Supabase",
    timeout: 5_000,
    factory: async () => ({
      createCompoundRepo: async () =>
        new SupabaseTabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>(
          client,
          `supabase_test_${uuid4().replace(/-/g, "_")}`,
          CompoundSchema,
          CompoundPrimaryKeyNames
        ),
      dispose: async () => {},
    }),
    capabilities: { subscriptions: true, vectorColumns: false },
    subscriptions: { usesPolling: false },
    // TODO(workglow): the Supabase mock client used in tests does not implement
    // realtime channels, so subscribe assertions cannot deliver INSERT events.
    // Against a real Supabase instance these assertions are expected to pass.
    expectedFailures: ["subscribe.fireOncePerWrite", "subscribe.commitOrder"],
  });
});
