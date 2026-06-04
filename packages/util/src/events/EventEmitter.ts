/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A type that represents a listener function for an event.
 * @template Events - A record of event names and their corresponding listener functions
 * @template EventType - The name of the event
 */
type EventListener<Events, EventType extends keyof Events> = Events[EventType];

/**
 * A type that represents a list of listener functions for an event.
 * @template Events - A record of event names and their corresponding listener functions
 * @template EventType - The name of the event
 */
type EventListeners<Events, EventType extends keyof Events> = Array<{
  listener: EventListener<Events, EventType>;
  once?: boolean;
}>;

/**
 * A type that represents the parameters of an event.
 * @template Events - A record of event names and their corresponding listener functions
 * @template EventType - The name of the event
 */
export type EventParameters<Events, EventType extends keyof Events> = {
  [Event in EventType]: EventListener<Events, EventType> extends (...args: infer P) => any
    ? P
    : never;
}[EventType];

/**
 * A type that represents the return type of the emitted method.
 * @template Events - A record of event names and their corresponding listener functions
 * @template EventType - The name of the event
 */
export type EmittedReturnType<Events, EventType extends keyof Events> = EventParameters<
  Events,
  EventType
>;

/**
 * A class that implements an event emitter pattern.
 * @template EventListenerTypes - A record of event names and their corresponding listener functions
 */
export class EventEmitter<EventListenerTypes extends Record<string, (...args: any) => any>> {
  private listeners: {
    [Event in keyof EventListenerTypes]?: EventListeners<EventListenerTypes, Event>;
  } = {};
  private maxListeners: number = 0;
  private warnedEvents = new Set<keyof EventListenerTypes>();

  /**
   * Set the maximum number of listeners per event before a warning is emitted.
   * 0 means unlimited (default).
   */
  setMaxListeners(n: number): this {
    if (!Number.isFinite(n) || n < 0) {
      throw new RangeError(`"n" must be a non-negative finite number. Got ${n}.`);
    }
    this.maxListeners = Math.trunc(n);
    this.warnedEvents.clear();
    return this;
  }

  /**
   * Get the number of listeners for a specific event
   */
  listenerCount<Event extends keyof EventListenerTypes>(event: Event): number {
    return this.listeners[event]?.length ?? 0;
  }

  /**
   * Get all event names that have registered listeners
   */
  eventNames(): Array<keyof EventListenerTypes> {
    return (Object.keys(this.listeners) as Array<keyof EventListenerTypes>).filter(
      (k) => (this.listeners[k]?.length ?? 0) > 0
    );
  }

  /**
   * Remove all listeners for a specific event or all events
   * @param event - Optional event name. If not provided, removes all listeners for all events
   * @returns this, so that calls can be chained
   */
  removeAllListeners<Event extends keyof EventListenerTypes>(event?: Event): this {
    if (event) {
      delete this.listeners[event];
      this.warnedEvents.delete(event);
    } else {
      this.listeners = {};
      this.warnedEvents.clear();
    }
    return this;
  }

  /**
   * Adds a listener function for the event
   * @param event - The event name to listen for
   * @param listener - The listener function to add
   * @returns this, so that calls can be chained
   */
  on<Event extends keyof EventListenerTypes>(
    event: Event,
    listener: EventListener<EventListenerTypes, Event>
  ): this {
    const listeners: EventListeners<EventListenerTypes, Event> =
      this.listeners[event] || (this.listeners[event] = []);
    listeners.push({ listener });
    this.checkMaxListeners(event, listeners.length);
    return this;
  }

  /**
   * Removes a listener function for the event
   * @param event - The event name to remove the listener from
   * @param listener - The listener function to remove
   * @returns this, so that calls can be chained
   */
  off<Event extends keyof EventListenerTypes>(
    event: Event,
    listener: EventListener<EventListenerTypes, Event>
  ): this {
    const listeners = this.listeners[event];
    if (!listeners) return this;

    const index = listeners.findIndex((l) => l.listener === listener);
    if (index >= 0) {
      listeners.splice(index, 1);
      if (this.maxListeners > 0 && listeners.length <= this.maxListeners) {
        this.warnedEvents.delete(event);
      }
    }
    return this;
  }

  /**
   * Adds a listener function for the event that will be called only once
   * @param event - The event name to listen for
   * @param listener - The listener function to add
   * @returns this, so that calls can be chained
   */
  once<Event extends keyof EventListenerTypes>(
    event: Event,
    listener: EventListener<EventListenerTypes, Event>
  ): this {
    const listeners: EventListeners<EventListenerTypes, Event> =
      this.listeners[event] || (this.listeners[event] = []);
    listeners.push({ listener, once: true });
    this.checkMaxListeners(event, listeners.length);
    return this;
  }

  /**
   * Returns a promise that resolves when the event is emitted
   * @param event - The event name to listen for
   * @returns a promise that resolves to an array of all parameters of the event (empty array for events with no parameters)
   */
  waitOn<Event extends keyof EventListenerTypes>(
    event: Event
  ): Promise<EmittedReturnType<EventListenerTypes, Event>> {
    return new Promise((resolve) => {
      const listener = ((...args: any[]) => {
        resolve(args as any);
      }) as EventListener<EventListenerTypes, Event>;

      this.once(event, listener);
    });
  }

  /**
   * Emits an event with the specified name and arguments
   * @param event - The event name to emit
   * @param args - Arguments to pass to the event listeners
   */
  public emit<Event extends keyof EventListenerTypes>(
    this: EventEmitter<EventListenerTypes>,
    event: Event,
    ...args: EventParameters<EventListenerTypes, Event>
  ) {
    const listeners: EventListeners<EventListenerTypes, Event> | undefined = this.listeners[event];
    if (listeners) {
      // Snapshot the listener array to avoid issues with concurrent modification
      const snapshot = [...listeners];
      const errors: unknown[] = [];
      for (const { listener } of snapshot) {
        try {
          listener(...args);
        } catch (e) {
          errors.push(e);
        }
      }
      // Remove once listeners we just called
      this.listeners[event] = listeners.filter((l) => !l.once);
      if (this.maxListeners > 0 && (this.listeners[event]?.length ?? 0) <= this.maxListeners) {
        this.warnedEvents.delete(event);
      }
      // Re-throw errors after all listeners have been called
      if (errors.length > 1) {
        throw new AggregateError(
          errors,
          `${errors.length} listener(s) threw on "${String(event)}"`
        );
      } else if (errors.length === 1) {
        throw errors[0];
      }
    }
  }

  private checkMaxListeners<Event extends keyof EventListenerTypes>(
    event: Event,
    count: number
  ): void {
    if (this.maxListeners > 0 && count > this.maxListeners && !this.warnedEvents.has(event)) {
      this.warnedEvents.add(event);
      console.warn(
        `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. ` +
          `${count} listeners added for event "${String(event)}". ` +
          `Use setMaxListeners() to increase limit (current: ${this.maxListeners}).`
      );
    }
  }

  /**
   * Subscribes to an event and returns a function to unsubscribe
   * @param event - The event name to subscribe to
   * @param listener - The listener function to add
   * @returns a function to unsubscribe from the event
   */
  public subscribe<Event extends keyof EventListenerTypes>(
    event: Event,
    listener: EventListener<EventListenerTypes, Event>
  ): () => void {
    this.on(event, listener);
    return () => this.off(event, listener);
  }
}
