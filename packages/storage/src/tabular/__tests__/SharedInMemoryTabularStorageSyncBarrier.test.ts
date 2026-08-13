/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { SharedInMemoryTabularStorage } from "@workglow/storage";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

const ItemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    value: { type: "string" },
  },
  required: ["id", "value"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

const ItemPK = ["id"] as const;

/**
 * Builds a fresh, isolated channel name so parallel test runs cannot collide.
 */
function uniqueChannel(label: string): string {
  return `sync_barrier_${label}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

describe("SharedInMemoryTabularStorage.setupDatabase awaits tab-sync by default", () => {
  it("first tab's first get sees rows another tab wrote before setupDatabase() returns", async () => {
    const channelName = uniqueChannel("default_await");

    // Simulate a peer tab that already has rows. `peer` constructed first so it
    // owns the canonical row set before the first tab calls setupDatabase().
    const peer = new SharedInMemoryTabularStorage<typeof ItemSchema, typeof ItemPK>(
      channelName,
      ItemSchema,
      ItemPK
    );
    await peer.setupDatabase();
    await peer.put({ id: "preexisting", value: "from-peer" });

    // Fresh tab joins the channel after the peer has populated rows.
    const fresh = new SharedInMemoryTabularStorage<typeof ItemSchema, typeof ItemPK>(
      channelName,
      ItemSchema,
      ItemPK
    );
    // Default is awaitTabSync: true — should not resolve until SYNC_RESPONSE
    // has been applied to the inner store.
    await fresh.setupDatabase();

    const row = await fresh.get({ id: "preexisting" } as any);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ id: "preexisting", value: "from-peer" });

    fresh.destroy();
    peer.destroy();
  });

  it("explicit awaitTabSync: false matches the prior fire-and-forget behavior (opt-out)", async () => {
    const channelName = uniqueChannel("opt_out");

    const fresh = new SharedInMemoryTabularStorage<typeof ItemSchema, typeof ItemPK>(
      channelName,
      ItemSchema,
      ItemPK
    );
    // No peer is on the channel, so there is nothing to wait for; the opt-out
    // path must still resolve promptly and the storage must still work.
    await fresh.setupDatabase({ awaitTabSync: false });

    await fresh.put({ id: "self", value: "from-self" });
    const row = await fresh.get({ id: "self" } as any);
    expect(row).toMatchObject({ id: "self", value: "from-self" });

    fresh.destroy();
  });

  it("setupDatabase() resolves even when no peer responds (timeout path)", async () => {
    const channelName = uniqueChannel("no_peer");

    const solo = new SharedInMemoryTabularStorage<typeof ItemSchema, typeof ItemPK>(
      channelName,
      ItemSchema,
      ItemPK
    );

    // With no peer broadcaster on the channel SYNC_RESPONSE never arrives;
    // setupDatabase must still resolve via the SYNC_TIMEOUT fallback rather
    // than hang. Bounded by a generous outer timeout in this test.
    await Promise.race([
      solo.setupDatabase(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("setupDatabase never resolved")), 5000)
      ),
    ]);

    solo.destroy();
  });
});
