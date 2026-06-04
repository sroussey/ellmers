/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PollingManagerOptions {
  readonly defaultIntervalMs?: number;
}

export type ChangeCallback<T> = (change: T) => void;

export type StateFetcher<Item, Key> = () => Promise<Map<Key, Item>>;

export type ItemComparator<Item> = (a: Item, b: Item) => boolean;

export interface ChangePayloadFactory<Item, ChangePayload> {
  readonly insert: (item: Item) => ChangePayload;
  readonly update: (oldItem: Item, newItem: Item) => ChangePayload;
  readonly delete: (item: Item) => ChangePayload;
}

export interface PollingSubscriptionOptions {
  readonly intervalMs?: number;
}

interface Subscription<ChangePayload> {
  readonly callback: ChangeCallback<ChangePayload>;
  readonly intervalMs: number;
}

/**
 * Consolidates polling subscribers into one polling loop per interval tier so
 * many subscriptions don't each spin up their own setInterval.
 */
export class PollingSubscriptionManager<Item, Key, ChangePayload> {
  private readonly intervals = new Map<
    number,
    {
      intervalId: ReturnType<typeof setInterval>;
      subscribers: Set<Subscription<ChangePayload>>;
    }
  >();

  private lastKnownState = new Map<Key, Item>();
  private initialized = false;
  /** Guards against poll/init race while the first state fetch is in flight. */
  private initializing = false;
  private readonly fetchState: StateFetcher<Item, Key>;
  private readonly compareItems: ItemComparator<Item>;
  private readonly payloadFactory: ChangePayloadFactory<Item, ChangePayload>;
  private readonly defaultIntervalMs: number;

  constructor(
    fetchState: StateFetcher<Item, Key>,
    compareItems: ItemComparator<Item>,
    payloadFactory: ChangePayloadFactory<Item, ChangePayload>,
    options?: PollingManagerOptions
  ) {
    this.fetchState = fetchState;
    this.compareItems = compareItems;
    this.payloadFactory = payloadFactory;
    this.defaultIntervalMs = options?.defaultIntervalMs ?? 1000;
  }

  subscribe(
    callback: ChangeCallback<ChangePayload>,
    options?: PollingSubscriptionOptions
  ): () => void {
    const interval = options?.intervalMs ?? this.defaultIntervalMs;
    const subscription: Subscription<ChangePayload> = {
      callback,
      intervalMs: interval,
    };

    let intervalGroup = this.intervals.get(interval);
    if (!intervalGroup) {
      const subscribers = new Set<Subscription<ChangePayload>>();
      const intervalId = setInterval(() => this.poll(subscribers), interval);

      intervalGroup = { intervalId, subscribers };
      this.intervals.set(interval, intervalGroup);

      if (!this.initialized) {
        this.initialized = true;
        this.initializing = true;
        this.initAndPoll(subscription);
      } else {
        this.pollForNewSubscriber(subscription);
      }
    } else {
      this.pollForNewSubscriber(subscription);
    }

    intervalGroup.subscribers.add(subscription);

    return () => {
      const group = this.intervals.get(interval);
      if (group) {
        group.subscribers.delete(subscription);

        if (group.subscribers.size === 0) {
          clearInterval(group.intervalId);
          this.intervals.delete(interval);
        }
      }
    };
  }

  private async initAndPoll(newSubscription: Subscription<ChangePayload>): Promise<void> {
    try {
      this.lastKnownState = await this.fetchState();
      // Replay initial state as INSERTs so the subscriber starts hydrated.
      for (const [, item] of this.lastKnownState) {
        const payload = this.payloadFactory.insert(item);
        try {
          newSubscription.callback(payload);
        } catch {}
      }
    } catch {
      // Init failures are swallowed; the next poll retries.
    } finally {
      this.initializing = false;
    }
  }

  private pollForNewSubscriber(subscription: Subscription<ChangePayload>): void {
    for (const [, item] of this.lastKnownState) {
      const payload = this.payloadFactory.insert(item);
      try {
        subscription.callback(payload);
      } catch {}
    }
  }

  private async poll(subscribers: Set<Subscription<ChangePayload>>): Promise<void> {
    if (subscribers.size === 0) return;
    // Don't poll until initAndPoll has finished establishing lastKnownState,
    // otherwise the diff would re-INSERT every row.
    if (this.initializing) return;

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
        for (const sub of subscribers) {
          try {
            sub.callback(change);
          } catch {}
        }
      }
    } catch {}
  }

  get subscriptionCount(): number {
    let count = 0;
    for (const group of this.intervals.values()) {
      count += group.subscribers.size;
    }
    return count;
  }

  get hasSubscriptions(): boolean {
    return this.intervals.size > 0;
  }

  destroy(): void {
    for (const group of this.intervals.values()) {
      clearInterval(group.intervalId);
    }
    this.intervals.clear();
    this.lastKnownState.clear();
    this.initialized = false;
    this.initializing = false;
  }
}
