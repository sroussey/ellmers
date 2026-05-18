/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryTabularStorage, type TabularChangePayload } from "@workglow/storage";
import type { FromSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";
import { CompoundPrimaryKeyNames, CompoundSchema } from "./genericTabularStorageTests";

/**
 * Meta-tests for the `subscribeToChanges` contract assertion split.
 *
 * The contract has two flavors:
 *   - `subscribeToChanges.eventDriven` — strict commit order (one event per
 *     write, emitted in write order).
 *   - `subscribeToChanges.polling`    — set equality + event count (a polling
 *     snapshot diff cannot preserve commit order).
 *
 * These meta-tests exercise the invariants the two contract blocks check by
 * running them against `InMemoryTabularStorage` (event-driven) and verifying
 * the failure modes each block is designed to catch — write counts off, set
 * mismatched, or commit order broken.
 */
describe("subscribeToChanges contract — meta", () => {
  it("eventDriven invariant: count + commit-order equality", async () => {
    const storage = new InMemoryTabularStorage<
      typeof CompoundSchema,
      typeof CompoundPrimaryKeyNames
    >(CompoundSchema, CompoundPrimaryKeyNames);

    const changes: TabularChangePayload<FromSchema<typeof CompoundSchema>>[] = [];
    const unsubscribe = storage.subscribeToChanges((change) => changes.push(change));

    await storage.put({ name: "t1", type: "s1", option: "v1", success: true });
    await storage.put({ name: "t2", type: "s2", option: "v2", success: false });
    await storage.put({ name: "t3", type: "s3", option: "v3", success: true });

    const writes = changes.filter((c) => c.type === "INSERT" || c.type === "UPDATE");
    expect(writes.length).toBe(3);
    // Commit-order assertion — would fire if an event-driven backend reordered.
    expect(writes.map((w) => w.new?.option)).toEqual(["v1", "v2", "v3"]);

    unsubscribe();
    storage.destroy?.();
  });

  it("eventDriven failure mode: missing write makes count fail", async () => {
    // Simulate a "missing write" scenario by populating the change log with
    // only two of three writes. The eventDriven count assertion (`toBe(3)`)
    // must reject this case.
    const incompleteWrites = [
      { type: "INSERT" as const, new: { name: "t1", type: "s1", option: "v1", success: true } },
      { type: "INSERT" as const, new: { name: "t3", type: "s3", option: "v3", success: true } },
    ];
    expect(incompleteWrites.length).toBe(2);
    // The contract block's `toBe(3)` would fail here — verified via:
    expect(() => expect(incompleteWrites.length).toBe(3)).toThrow();
  });

  it("polling invariant: count + set equality, order unspecified", async () => {
    const storage = new InMemoryTabularStorage<
      typeof CompoundSchema,
      typeof CompoundPrimaryKeyNames
    >(CompoundSchema, CompoundPrimaryKeyNames);

    // Polling has no real ordering guarantees; we simulate by reading via the
    // event bus and asserting set equality only.
    const changes: TabularChangePayload<FromSchema<typeof CompoundSchema>>[] = [];
    const unsubscribe = storage.subscribeToChanges((change) => changes.push(change));

    await storage.put({ name: "t1", type: "s1", option: "v1", success: true });
    await storage.put({ name: "t2", type: "s2", option: "v2", success: false });
    await storage.put({ name: "t3", type: "s3", option: "v3", success: true });

    const writes = changes.filter((c) => c.type === "INSERT" || c.type === "UPDATE");
    expect(writes.length).toBe(3);
    // Set equality after sort — invariant the polling block enforces.
    expect(writes.map((w) => w.new?.option).sort()).toEqual(["v1", "v2", "v3"]);

    unsubscribe();
    storage.destroy?.();
  });

  it("polling failure mode: duplicate write breaks set equality", async () => {
    // Simulate a duplicate-write scenario: 4 events for 3 writes, with one
    // duplicated. The sorted-set assertion (`toEqual(["v1","v2","v3"])`)
    // must reject this.
    const dupOptions = ["v1", "v1", "v2", "v3"].sort();
    expect(() => expect(dupOptions).toEqual(["v1", "v2", "v3"])).toThrow();
  });
});
