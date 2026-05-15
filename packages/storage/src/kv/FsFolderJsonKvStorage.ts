/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import { JsonSchema } from "@workglow/util/schema";
import { FsFolderTabularStorage } from "../tabular/FsFolderTabularStorage";
import { DefaultKeyValueKey, DefaultKeyValueSchema, IKvStorage } from "./IKvStorage";
import { KvViaTabularStorage } from "./KvViaTabularStorage";

export const FS_FOLDER_JSON_KV_REPOSITORY = createServiceToken<IKvStorage<string, any, any>>(
  "storage.kvRepository.fsFolderJson"
);

/**
 * A key-value repository implementation that stores values as JSON files in a specified folder.
 * Uses a tabular repository abstraction for file-based persistence.
 *
 * @template Key - The type of the primary key
 * @template Value - The type of the value being stored
 * @template Combined - Combined type of Key & Value
 */
export class FsFolderJsonKvStorage extends KvViaTabularStorage {
  public tabularRepository: FsFolderTabularStorage<
    typeof DefaultKeyValueSchema,
    typeof DefaultKeyValueKey
  >;

  /**
   * Creates a new KvStorage instance
   */
  constructor(
    public folderPath: string,
    keySchema: JsonSchema = { type: "string" },
    valueSchema: JsonSchema = {}
  ) {
    super(keySchema, valueSchema);
    this.tabularRepository = new FsFolderTabularStorage(
      folderPath,
      DefaultKeyValueSchema,
      DefaultKeyValueKey
    );
  }
}
