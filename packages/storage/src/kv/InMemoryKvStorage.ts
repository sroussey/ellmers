/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import type { JsonSchema } from "@workglow/util/schema";
import { InMemoryTabularStorage } from "../tabular/InMemoryTabularStorage";
import type { IKvStorage } from "./IKvStorage";
import { DefaultKeyValueKey, DefaultKeyValueSchema } from "./IKvStorage";
import { KvViaTabularStorage } from "./KvViaTabularStorage";

export const MEMORY_KV_REPOSITORY = createServiceToken<IKvStorage<string, any, any>>(
  "storage.kvRepository.inMemory"
);

/**
 * In-memory key-value repository, backed by an `InMemoryTabularStorage`.
 */
export class InMemoryKvStorage extends KvViaTabularStorage {
  public tabularRepository: InMemoryTabularStorage<
    typeof DefaultKeyValueSchema,
    typeof DefaultKeyValueKey
  >;

  constructor(keySchema: JsonSchema = { type: "string" }, valueSchema: JsonSchema = {}) {
    super(keySchema, valueSchema);
    this.tabularRepository = new InMemoryTabularStorage(DefaultKeyValueSchema, DefaultKeyValueKey);
  }
}
