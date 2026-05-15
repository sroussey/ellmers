/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import { JsonSchema } from "@workglow/util/schema";
import { InMemoryTabularStorage } from "../tabular/InMemoryTabularStorage";
import { DefaultKeyValueKey, DefaultKeyValueSchema, IKvStorage } from "./IKvStorage";
import { KvViaTabularStorage } from "./KvViaTabularStorage";

export const MEMORY_KV_REPOSITORY = createServiceToken<IKvStorage<string, any, any>>(
  "storage.kvRepository.inMemory"
);

/**
 * An in-memory key-value repository implementation for fast, ephemeral storage.
 * Uses a tabular repository abstraction for in-memory persistence.
 *
 * @template Key - The type of the primary key
 * @template Value - The type of the value being stored
 * @template Combined - Combined type of Key & Value
 */
export class InMemoryKvStorage extends KvViaTabularStorage {
  public tabularRepository: InMemoryTabularStorage<
    typeof DefaultKeyValueSchema,
    typeof DefaultKeyValueKey
  >;

  /**
   * Creates a new KvStorage instance
   */
  constructor(keySchema: JsonSchema = { type: "string" }, valueSchema: JsonSchema = {}) {
    super(keySchema, valueSchema);
    this.tabularRepository = new InMemoryTabularStorage(DefaultKeyValueSchema, DefaultKeyValueKey);
  }
}
