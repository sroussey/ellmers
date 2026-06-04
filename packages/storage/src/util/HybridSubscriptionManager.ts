/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export interface HybridManagerOptions {
  /** Default polling interval in milliseconds for backup polling */
  readonly defaultIntervalMs?: number;
  /** Backup polling interval in milliseconds (0 to disable, default: 5000) */
  readonly backupPollingIntervalMs?: number;
  /** Enable BroadcastChannel notifications (default: true) */
  readonly useBroadcastChannel?: boolean;
  /** BroadcastChannel name for cross-tab communication */
  readonly broadcastChannelName?: string;
}

import type {
  ChangeCallback,
  ChangePayloadFactory,
  ItemComparator,
  StateFetcher,
} from "./PollingSubscriptionManager";

export interface HybridSubscriptionOptions {
  /** Polling interval in milliseconds (not used if BroadcastChannel is active). */
  readonly intervalMs?: number;
}

interface Subscription<ChangePayload> {
  readonly callback: ChangeCallback<ChangePayload>;
  readonly intervalMs: number;
}

type BroadcastMessage =
  | { readonly type: "CHANGE" }
  | { readonly type: "HEARTBEAT"; readonly tabId: string; readonly timestamp: number };

/**
 * Combines three notification mechanisms behind a single subscription API:
 * local events (same-tab), BroadcastChannel (cross-tab, near-instant), and an
 * optional backup poll. Falls back to local events only when BroadcastChannel
 * is unavailable.
 */
export class HybridSubscriptionManager<Item, Key, ChangePayload> {
  private readonly subscribers = new Set<Subscription<ChangePayload>>();
  private lastKnownState = new Map<Key, Item>();
  private initialized = false;
  private channel: BroadcastChannel | null = null;
  private backupPollingIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly fetchState: StateFetcher<Item, Key>;
  private readonly compareItems: ItemComparator<Item>;
  private readonly payloadFactory: ChangePayloadFactory<Item, ChangePayload>;
  private readonly options: Required<HybridManagerOptions>;
  private readonly hasBroadcastChannel: boolean;

  constructor(
    channelName: string,
    fetchState: StateFetcher<Item, Key>,
    compareItems: ItemComparator<Item>,
    payloadFactory: ChangePayloadFactory<Item, ChangePayload>,
    options?: HybridManagerOptions
  ) {
    this.fetchState = fetchState;
    this.compareItems = compareItems;
    this.payloadFactory = payloadFactory;

    this.options = {
      defaultIntervalMs: options?.defaultIntervalMs ?? 1000,
      backupPollingIntervalMs: options?.backupPollingIntervalMs ?? 5000,
      useBroadcastChannel: options?.useBroadcastChannel ?? true,
      broadcastChannelName: options?.broadcastChannelName ?? channelName,
    };

    this.hasBroadcastChannel =
      this.options.useBroadcastChannel && typeof BroadcastChannel !== "undefined";

    if (this.hasBroadcastChannel) {
      this.initializeBroadcastChannel();
    }
  }

  private initializeBroadcastChannel(): void {
    try {
      this.channel = new BroadcastChannel(this.options.broadcastChannelName);
      this.channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
        this.handleBroadcastMessage(event.data);
      };
    } catch (error) {
      console.error("Failed to initialize BroadcastChannel:", error);
      this.channel = null;
    }
  }

  private async handleBroadcastMessage(message: BroadcastMessage): Promise<void> {
    if (message.type === "CHANGE") {
      await this.pollAndNotify();
    }
    // HEARTBEAT messages are reserved for future tab presence detection.
  }

  /** Must be called after any local mutation. */
  notifyLocalChange(): void {
    this.pollAndNotify();

    if (this.channel) {
      try {
        this.channel.postMessage({ type: "CHANGE" } as BroadcastMessage);
      } catch (error) {
        // Ignore broadcast errors.
      }
    }
  }

  subscribe(
    callback: ChangeCallback<ChangePayload>,
    options?: HybridSubscriptionOptions
  ): () => void {
    const interval = options?.intervalMs ?? this.options.defaultIntervalMs;
    const subscription: Subscription<ChangePayload> = {
      callback,
      intervalMs: interval,
    };

    const isFirstSubscriber = this.subscribers.size === 0;
    this.subscribers.add(subscription);

    if (isFirstSubscriber) {
      if (!this.initialized) {
        this.initialized = true;
        // Don't await so the subscribe() call returns immediately.
        void this.initAndNotify(subscription);
      } else {
        this.notifySubscriberOfCurrentState(subscription);
      }

      // Backup polling is reliability insurance even when BroadcastChannel is
      // active; it's the primary mechanism when BroadcastChannel is disabled.
      if (this.options.backupPollingIntervalMs > 0) {
        this.startBackupPolling();
      }
    } else {
      this.notifySubscriberOfCurrentState(subscription);
    }

    return () => {
      this.subscribers.delete(subscription);

      if (this.subscribers.size === 0) {
        this.stopBackupPolling();
      }
    };
  }

  private async initAndNotify(subscription: Subscription<ChangePayload>): Promise<void> {
    try {
      this.lastKnownState = await this.fetchState();
      // Replay initial state as INSERTs so the new subscriber starts hydrated.
      for (const [, item] of this.lastKnownState) {
        const payload = this.payloadFactory.insert(item);
        try {
          subscription.callback(payload);
        } catch {}
      }
    } catch {
      // Initialization failures are swallowed; the next poll retries.
    }
  }

  private notifySubscriberOfCurrentState(subscription: Subscription<ChangePayload>): void {
    for (const [, item] of this.lastKnownState) {
      const payload = this.payloadFactory.insert(item);
      try {
        subscription.callback(payload);
      } catch {}
    }
  }

  private async pollAndNotify(): Promise<void> {
    if (this.subscribers.size === 0) return;

    try {
      const currentState = await this.fetchState();
      const changes: ChangePayload[] = [];

      for (const [key, item] of currentState) {
        const oldItem = this.lastKnownState.get(key);
        if (!oldItem) {
          changes.push(this.payloadFactory.insert(item));
        } else if (!this.compareItems(oldItem, item)) {
          changes.push(this.payloadFactory.update(oldItem, item));
        }
      }

      for (const [key, item] of this.lastKnownState) {
        if (!currentState.has(key)) {
          changes.push(this.payloadFactory.delete(item));
        }
      }

      this.lastKnownState = currentState;

      for (const change of changes) {
        for (const sub of this.subscribers) {
          try {
            sub.callback(change);
          } catch {}
        }
      }
    } catch {}
  }

  private startBackupPolling(): void {
    if (this.backupPollingIntervalId) return;

    this.backupPollingIntervalId = setInterval(
      () => this.pollAndNotify(),
      this.options.backupPollingIntervalMs
    );
  }

  private stopBackupPolling(): void {
    if (this.backupPollingIntervalId) {
      clearInterval(this.backupPollingIntervalId);
      this.backupPollingIntervalId = null;
    }
  }

  get subscriptionCount(): number {
    return this.subscribers.size;
  }

  get hasSubscriptions(): boolean {
    return this.subscribers.size > 0;
  }

  get isBroadcastChannelActive(): boolean {
    return this.channel !== null;
  }

  destroy(): void {
    this.stopBackupPolling();
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.subscribers.clear();
    this.lastKnownState.clear();
    this.initialized = false;
  }
}
