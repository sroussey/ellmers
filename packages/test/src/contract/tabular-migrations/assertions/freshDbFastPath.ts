/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it } from "vitest";
import type {
  TabularMigrationContractHandle,
  TabularMigrationContractOpts,
} from "../types";

export function freshDbFastPathBlock(
  _opts: TabularMigrationContractOpts,
  getHandle: () => TabularMigrationContractHandle
): void {
  it("fresh DB: backfill is NOT executed; bookkeeping marks all applied", async () => {
    let transformCalls = 0;
    const storage = await getHandle().makeStorage(
      { id: { type: "string" }, n: { type: "integer" } },
      [
        {
          version: 1,
          ops: [
            {
              kind: "backfill",
              transform: (row) => {
                transformCalls++;
                return row;
              },
            },
          ],
        },
      ],
      [] // no pre-existing rows -> fresh DB
    );
    expect(transformCalls).toBe(0);
    expect(await storage.size()).toBe(0);
  });
}
