/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage, TabularChangePayload } from "@workglow/storage";
import { sleep } from "@workglow/util";
import type { FromSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CompoundPrimaryKeyNames,
  CompoundSchema,
} from "../../../test/storage-tabular/genericTabularStorageTests";
import { itExpectFail } from "../../itExpectFail";
import type { TabularStorageContractOpts } from "../types";

export function subscribeToChangesBlock(opts: TabularStorageContractOpts): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itImpl = expectFails.has("subscribeToChanges") ? itExpectFail : it;

  describe.skipIf(!opts.capabilities.supportsSubscriptions)("subscribeToChanges", () => {
    const usesPolling = opts.usesPolling ?? false;
    const pollingIntervalMs = opts.pollingIntervalMs ?? 1;
    const waitTime = usesPolling ? Math.max(pollingIntervalMs * 8, 200) : 50;
    const initWaitTime = usesPolling ? Math.max(pollingIntervalMs * 10, 300) : 10;

    let storage: ITabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>;

    beforeEach(async () => {
      storage = await opts.createStorage();
      await storage.setupDatabase?.();
    });

    afterEach(async () => {
      await storage.deleteAll();
      storage.destroy?.();
    });

    itImpl(
      "fires exactly once per write in commit order",
      async () => {
        const changes: TabularChangePayload<FromSchema<typeof CompoundSchema>>[] = [];
        const unsubscribe = storage.subscribeToChanges(
          (change) => changes.push(change),
          { pollingIntervalMs }
        );

        await sleep(initWaitTime);

        await storage.put({ name: "t1", type: "s1", option: "v1", success: true });
        await storage.put({ name: "t2", type: "s2", option: "v2", success: false });
        await storage.put({ name: "t3", type: "s3", option: "v3", success: true });

        await sleep(waitTime);

        const writeEvents = changes.filter(
          (c) => c.type === "INSERT" || c.type === "UPDATE"
        );
        expect(writeEvents.length).toBe(3);
        expect(writeEvents[0].new?.option).toBe("v1");
        expect(writeEvents[1].new?.option).toBe("v2");
        expect(writeEvents[2].new?.option).toBe("v3");

        unsubscribe();
      },
      opts.timeout
    );
  });
}
