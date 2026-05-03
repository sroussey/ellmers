/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { JsonSchema } from "@workglow/util/schema";
import { createServiceToken } from "@workglow/util";
import { IndexedDbTabularStorage } from "./IndexedDbTabularStorage";
import {
  DefaultKeyValueKey,
  DefaultKeyValueSchema,
  IKvStorage,
  KvViaTabularStorage,
} from "@workglow/storage";

export const IDB_KV_REPOSITORY = createServiceToken<IKvStorage<string, any, any>>(
  "storage.kvRepository.indexedDb"
);

/**
 * A key-value repository implementation that uses IndexedDB for persistent storage in the browser.
 * Leverages a tabular repository abstraction for IndexedDB operations.
 *
 * @template Key - The type of the primary key
 * @template Value - The type of the value being stored
 * @template Combined - Combined type of Key & Value
 */
export class IndexedDbKvStorage extends KvViaTabularStorage {
  public tabularRepository: IndexedDbTabularStorage<
    typeof DefaultKeyValueSchema,
    typeof DefaultKeyValueKey
  >;

  /**
   * Creates a new KvStorage instance
   */
  constructor(
    public dbName: string,
    keySchema: JsonSchema = { type: "string" },
    valueSchema: JsonSchema = {}
  ) {
    super(keySchema, valueSchema);
    this.tabularRepository = new IndexedDbTabularStorage(
      dbName,
      DefaultKeyValueSchema,
      DefaultKeyValueKey
    );
  }
}
