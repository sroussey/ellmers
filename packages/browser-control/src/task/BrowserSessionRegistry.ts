/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { uuid4 } from "@workglow/util";
import type { IBrowserContext } from "./IBrowserContext";

const sessions = new Map<string, IBrowserContext>();

export const BrowserSessionRegistry = {
  /**
   * Register a browser context and return a unique session ID.
   */
  register(context: IBrowserContext): string {
    const id = uuid4();
    sessions.set(id, context);
    return id;
  },

  /**
   * Retrieve a registered browser context by session ID.
   * Throws if the session does not exist or has been disconnected.
   */
  get(sessionId: string): IBrowserContext {
    const context = sessions.get(sessionId);
    if (!context) {
      throw new Error(`BrowserSessionRegistry: no session found for id "${sessionId}"`);
    }
    if (!context.isConnected()) {
      sessions.delete(sessionId);
      throw new Error(`BrowserSessionRegistry: session "${sessionId}" is no longer connected`);
    }
    return context;
  },

  /**
   * Remove a session from the registry.
   */
  unregister(sessionId: string): void {
    sessions.delete(sessionId);
  },

  /**
   * Returns true if a session with the given ID exists.
   */
  has(sessionId: string): boolean {
    return sessions.has(sessionId);
  },

  /**
   * Disconnect all registered contexts using Promise.allSettled, then clear the registry.
   */
  async disconnectAll(): Promise<void> {
    const disconnects = Array.from(sessions.values()).map((ctx) => ctx.disconnect());
    await Promise.allSettled(disconnects);
    sessions.clear();
  },

  /**
   * Clear all sessions without disconnecting (for tests).
   */
  clear(): void {
    sessions.clear();
  },
} as const;
