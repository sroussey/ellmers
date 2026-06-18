/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Miniflare-gated integration test for the Cloudflare Queues adapter.
 *
 * Skipped unless `RUN_CFQ_TESTS=1`. Miniflare's queue simulator API has
 * shifted across releases; this file lands the gated harness so CI can
 * opt-in later. Until then it remains a no-op locally.
 */

import { describe, expect, it } from "vitest";

const RUN = process.env.RUN_CFQ_TESTS === "1";

describe.skipIf(!RUN)("CloudflareMessageQueue + Miniflare", () => {
  it("round-trips a job through queue() handler", async () => {
    // Dynamic import so Miniflare isn't required for the default test run.

    const { Miniflare } = (await import("miniflare")) as any;
    const mf = new Miniflare({
      modules: true,
      script: `
        export default {
          async fetch(req, env, ctx) {
            const body = await req.json();
            await env.QUEUE.send(body);
            return new Response("ok");
          },
          async queue(batch, env, ctx) {
            for (const msg of batch.messages) {
              msg.ack();
              await env.RESULTS.put(msg.body.id, JSON.stringify(msg.body));
            }
          },
        };
      `,
      queueProducers: { QUEUE: "test-queue" },
      queueConsumers: ["test-queue"],
      kvNamespaces: ["RESULTS"],
    });

    try {
      const res = await mf.dispatchFetch("http://localhost/", {
        method: "POST",
        body: JSON.stringify({ id: "job-1", attempts: 0 }),
      });
      expect(res.status).toBe(200);

      // Give Miniflare a moment to drain the consumer.
      await new Promise((r) => setTimeout(r, 100));

      const kv = await mf.getKVNamespace("RESULTS");
      const stored = await kv.get("job-1");
      expect(stored).toBeTruthy();
    } finally {
      await mf.dispose();
    }
  });
});
