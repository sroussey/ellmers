/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ConnectionReentryError,
  withConnectionTransaction,
  type ITabularStorage,
} from "@workglow/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  CompoundPrimaryKeyNames,
  CompoundSchema,
} from "../../../test/storage-tabular/genericTabularStorageTests";
import { itExpectFail } from "../../itExpectFail";
import type { TabularStorageContractOpts } from "../types";

export function withConnectionTransactionBlock(opts: TabularStorageContractOpts): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itImpl = expectFails.has("withConnectionTransaction") ? itExpectFail : it;

  describe.skipIf(
    !opts.capabilities.supportsTransactions || opts.createSiblingStorage === undefined
  )("withConnectionTransaction", () => {
    let primary: ITabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>;
    let sibling: ITabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>;
    let outsider: ITabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>;

    beforeEach(async () => {
      primary = await opts.createStorage();
      await primary.setupDatabase?.();
      sibling = await opts.createSiblingStorage!(primary);
      await sibling.setupDatabase?.();
      outsider = await opts.createSiblingStorage!(primary);
      await outsider.setupDatabase?.();
    });

    afterEach(async () => {
      await outsider?.deleteAll();
      outsider?.destroy?.();
      await sibling?.deleteAll();
      sibling?.destroy?.();
      await primary?.deleteAll();
      primary?.destroy?.();
      // Siblings share `primary`'s handle, so they are released with it —
      // release last, after every storage on that handle is destroyed.
      await opts.releaseStorage?.(primary);
    });

    itImpl(
      "commits writes across two tables",
      async () => {
        await withConnectionTransaction([primary, sibling], async () => {
          await primary.put({ name: "from-a", type: "x", option: "va", success: true });
          await sibling.put({ name: "from-b", type: "x", option: "vb", success: true });
        });
        expect(await primary.get({ name: "from-a", type: "x" })).toMatchObject({ option: "va" });
        expect(await sibling.get({ name: "from-b", type: "x" })).toMatchObject({ option: "vb" });
      },
      opts.timeout
    );

    itImpl(
      "rolls back both tables when the callback throws",
      async () => {
        await primary.put({ name: "kept", type: "x", option: "base", success: true });

        await expect(
          withConnectionTransaction([primary, sibling], async () => {
            await primary.put({ name: "from-a", type: "x", option: "va", success: true });
            await sibling.put({ name: "from-b", type: "x", option: "vb", success: true });
            throw new Error("forced rollback");
          })
        ).rejects.toThrow("forced rollback");

        expect(await primary.get({ name: "kept", type: "x" })).toBeDefined();
        expect(await primary.get({ name: "from-a", type: "x" })).toBeUndefined();
        expect(await sibling.get({ name: "from-b", type: "x" })).toBeUndefined();
      },
      opts.timeout
    );

    itImpl(
      "throws sibling-op for a storage that was not enlisted",
      async () => {
        let error: unknown;
        await withConnectionTransaction([primary, sibling], async () => {
          await primary.put({ name: "enlisted", type: "x", option: "ok", success: true });
          try {
            await outsider.put({ name: "outsider", type: "x", option: "no", success: true });
          } catch (err) {
            error = err;
          }
        });

        expect(error).toBeInstanceOf(ConnectionReentryError);
        expect((error as ConnectionReentryError).mode).toBe("sibling-op");
        expect(await outsider.get({ name: "outsider", type: "x" })).toBeUndefined();
        expect(await primary.get({ name: "enlisted", type: "x" })).toBeDefined();
      },
      opts.timeout
    );
  });
}
