/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IKvStorage } from "@workglow/storage";
import { DefaultKeyValueKey, DefaultKeyValueSchema, KvViaTabularStorage } from "@workglow/storage";
import { createServiceToken } from "@workglow/util";
import type { JsonSchema } from "@workglow/util/schema";
import { SqliteTabularStorage } from "./SqliteTabularStorage";

export const SQLITE_KV_REPOSITORY = createServiceToken<IKvStorage<string, any, any>>(
  "storage.kvRepository.sqlite"
);

/**
 * A key-value repository implementation that uses SQLite for persistent storage.
 * Leverages a tabular repository abstraction for SQLite operations.
 *
 * @template Key - The type of the primary key
 * @template Value - The type of the value being stored
 * @template Combined - Combined type of Key & Value
 */
export class SqliteKvStorage extends KvViaTabularStorage {
  public tabularRepository: SqliteTabularStorage<
    typeof DefaultKeyValueSchema,
    typeof DefaultKeyValueKey
  >;

  /**
   * Creates a new KvStorage instance
   */
  constructor(
    public db: any,
    public dbName: string,
    keySchema: JsonSchema = { type: "string" },
    valueSchema: JsonSchema = {}
  ) {
    super(keySchema, valueSchema);
    this.tabularRepository = new SqliteTabularStorage(
      db,
      dbName,
      DefaultKeyValueSchema,
      DefaultKeyValueKey
    );
  }
}
