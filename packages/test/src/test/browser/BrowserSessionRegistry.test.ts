/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserSessionRegistry } from "@workglow/browser-control/task";
import { beforeEach, describe, expect, test } from "vitest";
import { MockBrowserContext } from "./MockBrowserContext";

describe("BrowserSessionRegistry", () => {
  beforeEach(() => {
    BrowserSessionRegistry.clear();
  });

  test("register and get a session", () => {
    const ctx = new MockBrowserContext();
    ctx.connected = true;
    const id = BrowserSessionRegistry.register(ctx);

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(BrowserSessionRegistry.get(id)).toBe(ctx);
  });

  test("get throws for unknown session", () => {
    expect(() => BrowserSessionRegistry.get("nonexistent-id")).toThrow(
      'BrowserSessionRegistry: no session found for id "nonexistent-id"'
    );
  });

  test("get throws and auto-prunes disconnected session", () => {
    const ctx = new MockBrowserContext();
    ctx.connected = true;
    const id = BrowserSessionRegistry.register(ctx);

    ctx.connected = false;

    expect(() => BrowserSessionRegistry.get(id)).toThrow("no longer connected");
    expect(BrowserSessionRegistry.has(id)).toBe(false);
  });

  test("unregister removes session", () => {
    const ctx = new MockBrowserContext();
    ctx.connected = true;
    const id = BrowserSessionRegistry.register(ctx);

    expect(BrowserSessionRegistry.has(id)).toBe(true);

    BrowserSessionRegistry.unregister(id);

    expect(BrowserSessionRegistry.has(id)).toBe(false);
    expect(() => BrowserSessionRegistry.get(id)).toThrow();
  });

  test("disconnectAll disconnects all sessions", async () => {
    const ctx1 = new MockBrowserContext();
    const ctx2 = new MockBrowserContext();

    ctx1.connected = true;
    ctx2.connected = true;

    const id1 = BrowserSessionRegistry.register(ctx1);
    const id2 = BrowserSessionRegistry.register(ctx2);

    await BrowserSessionRegistry.disconnectAll();

    expect(ctx1.connected).toBe(false);
    expect(ctx2.connected).toBe(false);

    // Registry should be cleared after disconnectAll
    expect(BrowserSessionRegistry.has(id1)).toBe(false);
    expect(BrowserSessionRegistry.has(id2)).toBe(false);
  });

  test("clear removes all sessions", () => {
    const ctx1 = new MockBrowserContext();
    const ctx2 = new MockBrowserContext();

    const id1 = BrowserSessionRegistry.register(ctx1);
    const id2 = BrowserSessionRegistry.register(ctx2);

    expect(BrowserSessionRegistry.has(id1)).toBe(true);
    expect(BrowserSessionRegistry.has(id2)).toBe(true);

    BrowserSessionRegistry.clear();

    expect(BrowserSessionRegistry.has(id1)).toBe(false);
    expect(BrowserSessionRegistry.has(id2)).toBe(false);
  });
});
