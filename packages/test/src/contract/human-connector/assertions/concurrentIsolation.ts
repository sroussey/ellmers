/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IHumanRequest, IHumanResponse } from "@workglow/util";
import { describe, expect, it } from "vitest";

import { itExpectFail } from "../../itExpectFail";
import type {
  ConformanceFixture,
  HumanConnectorConformanceHandle,
  HumanConnectorConformanceOpts,
} from "../types";

function elicitReq(fixture: ConformanceFixture, requestId: string): IHumanRequest {
  return {
    requestId,
    targetHumanId: "default",
    kind: "elicit",
    message: "Please confirm.",
    contentSchema: fixture.elicitContentSchema,
    contentData: undefined,
    expectsResponse: true,
    mode: "single",
    metadata: undefined,
  };
}

export function concurrentIsolationBlock(
  opts: HumanConnectorConformanceOpts,
  fixture: ConformanceFixture,
  getHandle: () => HumanConnectorConformanceHandle
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itConcurrent = expectFails.has("concurrent.isolation") ? itExpectFail : it;

  describe.skipIf(!opts.capabilities.concurrent || !opts.capabilities.elicit)(
    "Concurrent isolation",
    () => {
      itConcurrent(
        "two concurrent send() calls each receive their own scripted response",
        async () => {
          const { connector, script } = getHandle();
          script.push((req): IHumanResponse => {
            return {
              requestId: req.requestId,
              action: "accept",
              content: { tag: req.requestId },
              done: true,
            };
          });
          script.push((req): IHumanResponse => {
            return {
              requestId: req.requestId,
              action: "accept",
              content: { tag: req.requestId },
              done: true,
            };
          });

          const ac = new AbortController();
          const p1 = connector.send(elicitReq(fixture, "conc-A"), ac.signal);
          const p2 = connector.send(elicitReq(fixture, "conc-B"), ac.signal);
          const [a, b] = await Promise.all([p1, p2]);

          expect(a.requestId).toBe("conc-A");
          expect((a.content as { tag: string }).tag).toBe("conc-A");
          expect(b.requestId).toBe("conc-B");
          expect((b.content as { tag: string }).tag).toBe("conc-B");
        },
        opts.timeout
      );
    }
  );
}
