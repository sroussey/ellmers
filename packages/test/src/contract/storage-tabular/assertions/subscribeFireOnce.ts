/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TabularChangePayload } from "@workglow/storage";
import { sleep } from "@workglow/util";
import type { FromSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { itExpectFail } from "../../itExpectFail";
import type { CompoundSchema } from "../../../test/storage-tabular/genericTabularStorageTests";
import type { TabularContractHandle, TabularStorageContractOpts } from "../types";

type CompoundEntity = FromSchema<typeof CompoundSchema>;

export function subscribeFireOnceBlock(
  opts: TabularStorageContractOpts,
  getHandle: () => TabularContractHandle
): void {
  const enabled = opts.capabilities.subscriptions;
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itImpl = expectFails.has("subscribe.fireOncePerWrite") ? itExpectFail : it;
  const usesPolling = opts.subscriptions?.usesPolling ?? false;
  const pollingIntervalMs = opts.subscriptions?.pollingIntervalMs ?? 1;
  const initWaitTime = usesPolling ? Math.max(pollingIntervalMs * 10, 300) : 10;
  const settleWaitTime = usesPolling ? Math.max(pollingIntervalMs * 8, 200) : 50;

  describe.skipIf(!enabled)("Subscribe fires once per write", () => {
    let repo: Awaited<ReturnType<TabularContractHandle["createCompoundRepo"]>>;

    beforeEach(async () => {
      repo = await getHandle().createCompoundRepo();
      await repo.setupDatabase?.();
    });

    afterEach(async () => {
      await repo.deleteAll();
      repo.destroy();
    });

    itImpl(
      "callback fires exactly once per put with INSERT type",
      async () => {
        const changes: TabularChangePayload<CompoundEntity>[] = [];
        const unsubscribe = repo.subscribeToChanges(
          (change) => changes.push(change),
          opts.subscriptions
        );
        await sleep(initWaitTime);

        const writes = [
          { name: "a", type: "t", option: "o1", success: true },
          { name: "b", type: "t", option: "o2", success: true },
          { name: "c", type: "t", option: "o3", success: true },
        ];
        for (const w of writes) await repo.put(w);
        await sleep(settleWaitTime);

        const inserts = changes.filter((c) => c.type === "INSERT");
        expect(inserts.length).toBe(writes.length);

        unsubscribe();
      },
      opts.timeout
    );
  });
}
