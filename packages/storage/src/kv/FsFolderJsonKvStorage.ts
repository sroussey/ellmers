/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "@workglow/util";
import type { JsonSchema } from "@workglow/util/schema";
import { FsFolderTabularStorage } from "../tabular/FsFolderTabularStorage";
import type { IKvStorage } from "./IKvStorage";
import { DefaultKeyValueKey, DefaultKeyValueSchema } from "./IKvStorage";
import { KvViaTabularStorage } from "./KvViaTabularStorage";

export const FS_FOLDER_JSON_KV_REPOSITORY = createServiceToken<IKvStorage<string, any, any>>(
  "storage.kvRepository.fsFolderJson"
);

/**
 * Key-value repository that stores values as JSON files in a folder, via
 * {@link FsFolderTabularStorage}.
 */
export class FsFolderJsonKvStorage extends KvViaTabularStorage {
  public tabularRepository: FsFolderTabularStorage<
    typeof DefaultKeyValueSchema,
    typeof DefaultKeyValueKey
  >;

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
