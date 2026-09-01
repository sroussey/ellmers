/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IHumanRequest } from "@workglow/util";
import { describe, expect, it } from "vitest";
import { RunEventHumanConnector } from "./RunEventHumanConnector";
import type { RunEvent } from "./RunEventTypes";

const request: IHumanRequest = {
  requestId: "r1",
  targetHumanId: "default",
  kind: "elicit",
  message: "Passphrase",
  contentSchema: { type: "object", properties: { value: { type: "string" } } } as never,
  contentData: undefined,
  expectsResponse: true,
  mode: "single",
  metadata: undefined,
};

describe("RunEventHumanConnector", () => {
  it("asks over the channel and resolves when the answer comes back", async () => {
    const events: RunEvent[] = [];
    const connector = new RunEventHumanConnector({
      emit: (e) => events.push(e),
      close: async () => {},
    });
    const pending = connector.send(request, new AbortController().signal);
    expect(events.at(-1)).toMatchObject({ k: "human_request", requestId: "r1", kind: "elicit" });
    connector.feedHumanResponseLine(
      JSON.stringify({ requestId: "r1", action: "accept", content: { value: "hunter2" } })
    );
    await expect(pending).resolves.toMatchObject({
      action: "accept",
      content: { value: "hunter2" },
    });
  });

  it("ignores a line that is not an answer to anything", () => {
    const connector = new RunEventHumanConnector({ emit: () => {}, close: async () => {} });
    expect(() => connector.feedHumanResponseLine("not json")).not.toThrow();
    expect(() => connector.feedHumanResponseLine('{"action":"accept"}')).not.toThrow();
  });

  it("cancels when the run is aborted rather than hanging the child forever", async () => {
    const controller = new AbortController();
    const connector = new RunEventHumanConnector({ emit: () => {}, close: async () => {} });
    const pending = connector.send(request, controller.signal);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ action: "cancel", done: true });
  });
});
