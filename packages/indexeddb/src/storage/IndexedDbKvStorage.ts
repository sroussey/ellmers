/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DefaultKeyValueKey,
  DefaultKeyValueSchema,
  IKvStorage,
  KvViaTabularStorage,
} from "@workglow/storage";
import { createServiceToken } from "@workglow/util";
import { JsonSchema } from "@workglow/util/schema";
import { IndexedDbTabularStorage } from "./IndexedDbTabularStorage";

export const IDB_KV_REPOSITORY = createServiceToken<IKvStorage<string, any, any>>(
  "storage.kvRepository.indexedDb"
);

export class IndexedDbKvStorage extends KvViaTabularStorage {
  public tabularRepository: IndexedDbTabularStorage<
    typeof DefaultKeyValueSchema,
    typeof DefaultKeyValueKey
  >;

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
