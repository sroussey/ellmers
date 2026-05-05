/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TabularChangePayload } from "@workglow/storage";
import { sleep } from "@workglow/util";
import type { FromSchema } from "@workglow/util/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { itExpectFail } from "../../itExpectFail";
import type { CompoundSchema } from "../../../test/storage-tabular/genericTabularStorageTests";
import type { TabularContractHandle, TabularStorageContractOpts } from "../types";

type CompoundEntity = FromSchema<typeof CompoundSchema>;

export function subscribeCommitOrderBlock(
  opts: TabularStorageContractOpts,
  getHandle: () => TabularContractHandle
): void {
  const enabled = opts.capabilities.subscriptions;
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itImpl = expectFails.has("subscribe.commitOrder") ? itExpectFail : it;
  const usesPolling = opts.subscriptions?.usesPolling ?? false;
  const pollingIntervalMs = opts.subscriptions?.pollingIntervalMs ?? 1;
  const initWaitTime = usesPolling ? Math.max(pollingIntervalMs * 10, 300) : 10;
  const settleWaitTime = usesPolling ? Math.max(pollingIntervalMs * 8, 200) : 50;

  describe.skipIf(!enabled)("Subscribe commit order", () => {
    let repo: Awaited<ReturnType<TabularContractHandle["createCompoundRepo"]>>;

    beforeAll(async () => {
      repo = await getHandle().createCompoundRepo();
      await repo.setupDatabase?.();
    }, opts.timeout);

    afterAll(async () => {
      await repo.deleteAll();
      repo.destroy();
    });

    itImpl(
      "three sequential puts arrive in callback in commit order",
      async () => {
        const observedNames: string[] = [];
        const unsubscribe = repo.subscribeToChanges(
          (change: TabularChangePayload<CompoundEntity>) => {
            if (change.type === "INSERT" && change.new) {
              observedNames.push(change.new.name);
            }
          },
          opts.subscriptions
        );
        await sleep(initWaitTime);

        await repo.put({ name: "alpha", type: "t", option: "x", success: true });
        await repo.put({ name: "bravo", type: "t", option: "y", success: true });
        await repo.put({ name: "charlie", type: "t", option: "z", success: true });
        await sleep(settleWaitTime);

        expect(observedNames).toEqual(["alpha", "bravo", "charlie"]);

        unsubscribe();
      },
      opts.timeout
    );
  });
}
