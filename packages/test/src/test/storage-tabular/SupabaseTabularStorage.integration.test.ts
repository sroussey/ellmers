/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SupabaseTabularStorage } from "@workglow/supabase/storage";
import { StorageValidationError } from "@workglow/storage";
import { setLogger, uuid4 } from "@workglow/util";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getTestingLogger } from "../../binding/TestingLogger";
import { createSupabaseMockClient } from "../helpers/SupabaseMockClient";
import {
  AllTypesPrimaryKeyNames,
  AllTypesSchema,
  CompoundPrimaryKeyNames,
  CompoundSchema,
  PAYLOADS,
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

  it("rejects adversarial orderBy before calling Supabase from()", async () => {
    const storage = new SupabaseTabularStorage<typeof SearchSchema, typeof SearchPrimaryKeyNames>(
      client,
      `supabase_test_${uuid4().replace(/-/g, "_")}`,
      SearchSchema,
      SearchPrimaryKeyNames,
      ["category"]
    );
    await storage.setupDatabase();

    const fromSpy = vi.spyOn(client, "from");
    fromSpy.mockClear();
    try {
      await expect(
        storage.getPage({ orderBy: [{ column: PAYLOADS[0] as any, direction: "ASC" }] })
      ).rejects.toThrow(StorageValidationError);
      await expect(
        storage.queryPage(
          { category: "electronics" },
          { orderBy: [{ column: "id", direction: "ASC; DROP--" as any }] }
        )
      ).rejects.toThrow(StorageValidationError);
      await expect(
        storage.getAll({ orderBy: [{ column: PAYLOADS[1] as any, direction: "ASC" }] })
      ).rejects.toThrow(StorageValidationError);
      await expect(
        storage.query(
          { category: "electronics" },
          { orderBy: [{ column: "id", direction: "ASC; DROP--" as any }] }
        )
      ).rejects.toThrow(StorageValidationError);

      expect(fromSpy).not.toHaveBeenCalled();
    } finally {
      fromSpy.mockRestore();
      await storage.deleteAll();
      storage.destroy();
    }
  });

  // Subscription tests skipped for Supabase because mock client doesn't support realtime
  // In production, Supabase uses realtime subscriptions which require a real Supabase instance
});
