/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { StorageError } from "./StorageError";

export class CoveringIndexMissingError extends StorageError {
  static override readonly type: string = "CoveringIndexMissingError";

  public readonly table: string;
  public readonly requiredColumns: readonly string[];
  public readonly registeredIndexes: ReadonlyArray<readonly string[]>;

  constructor(
    table: string,
    requiredColumns: readonly string[],
    registeredIndexes: ReadonlyArray<readonly string[]>
  ) {
    const indexList = registeredIndexes
      .map((cols) => `[${cols.join(", ")}]`)
      .join(", ");
    super(
      `No covering index for table "${table}". ` +
        `Required columns: [${requiredColumns.join(", ")}]. ` +
        `Registered indexes: ${indexList || "(none)"}.`
    );
    this.table = table;
    this.requiredColumns = requiredColumns;
    this.registeredIndexes = registeredIndexes;
  }
}
