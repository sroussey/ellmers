/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IKvStorage } from "@workglow/storage";
import { DefaultKeyValueKey, DefaultKeyValueSchema, KvViaTabularStorage } from "@workglow/storage";
import { createServiceToken } from "@workglow/util";
import type { JsonSchema } from "@workglow/util/schema";
import { SupabaseTabularStorage } from "./SupabaseTabularStorage";

export const SUPABASE_KV_REPOSITORY = createServiceToken<IKvStorage<string, any, any>>(
  "storage.kvRepository.supabase"
);

/**
 * A key-value repository implementation that uses Supabase for persistent storage.
 * Leverages a tabular repository abstraction for Supabase operations.
 *
 * @template Key - The type of the primary key
 * @template Value - The type of the value being stored
 * @template Combined - Combined type of Key & Value
 */
export class SupabaseKvStorage extends KvViaTabularStorage {
  public tabularRepository: SupabaseTabularStorage<
    typeof DefaultKeyValueSchema,
    typeof DefaultKeyValueKey
  >;

  /**
   * Creates a new SupabaseKvStorage instance
   *
   * @param client - Supabase client instance
   * @param tableName - Name of the table to store data
   * @param keySchema - Schema for the key type (defaults to string)
   * @param valueSchema - Schema for the value type (defaults to any)
   */
  constructor(
    public client: unknown,
    public tableName: string,
    keySchema: JsonSchema = { type: "string" },
    valueSchema: JsonSchema = {},
    tabularRepository?: SupabaseTabularStorage<
      typeof DefaultKeyValueSchema,
      typeof DefaultKeyValueKey
    >
  ) {
    super(keySchema, valueSchema);
    this.tabularRepository =
      tabularRepository ??
      new SupabaseTabularStorage(client, tableName, DefaultKeyValueSchema, DefaultKeyValueKey);
  }
}
