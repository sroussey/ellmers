/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IHumanRequest } from "@workglow/util";
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

export function roundtripBlock(
  opts: HumanConnectorConformanceOpts,
  fixture: ConformanceFixture,
  getHandle: () => HumanConnectorConformanceHandle
): void {
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itAccept = expectFails.has("roundtrip.accept") ? itExpectFail : it;
  const itDecline = expectFails.has("roundtrip.decline") ? itExpectFail : it;
  const itCancel = expectFails.has("roundtrip.cancel") ? itExpectFail : it;

  describe.skipIf(!opts.capabilities.elicit)("Roundtrip elicit", () => {
    itAccept(
      "accept echoes requestId, returns done=true, surfaces content",
      async () => {
        const { connector, script } = getHandle();
        script.push({
          requestId: "ignored",
          action: "accept",
          content: fixture.elicitAcceptContent,
          done: true,
        });
        const ac = new AbortController();
        const res = await connector.send(elicitReq(fixture, "rt-accept-1"), ac.signal);
        expect(res.requestId).toBe("rt-accept-1");
        expect(res.action).toBe("accept");
        expect(res.done).toBe(true);
        expect(res.content).toEqual(fixture.elicitAcceptContent);
      },
      opts.timeout
    );

    itDecline(
      "decline surfaces with content=undefined, no throw",
      async () => {
        const { connector, script } = getHandle();
        script.push({ requestId: "x", action: "decline", content: undefined, done: true });
        const ac = new AbortController();
        const res = await connector.send(elicitReq(fixture, "rt-dec-1"), ac.signal);
        expect(res.action).toBe("decline");
        expect(res.content).toBeUndefined();
      },
      opts.timeout
    );

    itCancel(
      "cancel surfaces with content=undefined, no throw",
      async () => {
        const { connector, script } = getHandle();
        script.push({ requestId: "x", action: "cancel", content: undefined, done: true });
        const ac = new AbortController();
        const res = await connector.send(elicitReq(fixture, "rt-can-1"), ac.signal);
        expect(res.action).toBe("cancel");
        expect(res.content).toBeUndefined();
      },
      opts.timeout
    );
  });
}
