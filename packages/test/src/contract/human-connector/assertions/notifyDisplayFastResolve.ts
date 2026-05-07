/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HumanInteractionKind, IHumanRequest } from "@workglow/util";
import { describe, expect, it } from "vitest";

import { itExpectFail } from "../../itExpectFail";
import type {
  ConformanceFixture,
  HumanConnectorAssertionId,
  HumanConnectorConformanceHandle,
  HumanConnectorConformanceOpts,
} from "../types";

function buildReq(
  fixture: ConformanceFixture,
  kind: "notify" | "display",
  requestId: string
): IHumanRequest {
  const base = kind === "notify" ? fixture.notifyRequest : fixture.displayRequest;
  return {
    requestId,
    targetHumanId: "default",
    kind: kind as HumanInteractionKind,
    message: base.message,
    contentSchema: base.contentSchema,
    contentData: base.contentData,
    expectsResponse: false,
    mode: "single",
    metadata: undefined,
  };
}

function block(
  kind: "notify" | "display",
  enabled: boolean,
  failId: HumanConnectorAssertionId,
  opts: HumanConnectorConformanceOpts,
  fixture: ConformanceFixture,
  getHandle: () => HumanConnectorConformanceHandle
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itFn = expectFails.has(failId) ? itExpectFail : it;

  describe.skipIf(!enabled)(`${kind} fast-resolve`, () => {
    itFn(
      `${kind} resolves with action=accept, done=true, no script consumption`,
      async () => {
        const { connector, script } = getHandle();
        const beforeQueueLen = script.received.length;
        const ac = new AbortController();
        const res = await connector.send(buildReq(fixture, kind, `${kind}-1`), ac.signal);
        expect(res.action).toBe("accept");
        expect(res.done).toBe(true);
        expect(res.content).toBeUndefined();
        // The connector should not have required a scripted entry. We assert
        // received did not shrink (it may grow if the connector still records
        // the request through the script handle).
        expect(script.received.length).toBeGreaterThanOrEqual(beforeQueueLen);
      },
      opts.timeout
    );
  });
}

export function notifyDisplayFastResolveBlock(
  opts: HumanConnectorConformanceOpts,
  fixture: ConformanceFixture,
  getHandle: () => HumanConnectorConformanceHandle
): void {
  block("notify", opts.capabilities.notify, "notify.fastResolve", opts, fixture, getHandle);
  block("display", opts.capabilities.display, "display.fastResolve", opts, fixture, getHandle);
}
