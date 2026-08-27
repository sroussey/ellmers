/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter, setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.fn;

// Define event types for testing
interface TestEvents extends Record<string, (...args: any) => any> {
  test: (value: string) => void;
  multipleArgs: (arg1: string, arg2: number, arg3: boolean) => void;
  noArgs: () => void;
}

describe("EventEmitter", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let emitter: EventEmitter<TestEvents>;

  beforeEach(() => {
    emitter = new EventEmitter<TestEvents>();
  });

  describe("on and emit", () => {
    it("should register and trigger an event listener", () => {
      const listener = mock((_value: string) => {});

      emitter.on("test", listener);
      emitter.emit("test", "hello");

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith("hello");
    });

    it("should handle multiple listeners for the same event", () => {
      const listener1 = mock((_value: string) => {});
      const listener2 = mock((_value: string) => {});

      emitter.on("test", listener1);
      emitter.on("test", listener2);
      emitter.emit("test", "hello");

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener1).toHaveBeenCalledWith("hello");
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledWith("hello");
    });

    it("should handle events with multiple arguments", () => {
      const listener = mock((_arg1: string, _arg2: number, _arg3: boolean) => {});

      emitter.on("multipleArgs", listener);
      emitter.emit("multipleArgs", "test", 42, true);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith("test", 42, true);
    });

    it("should handle events with no arguments", () => {
      const listener = mock(() => {});

      emitter.on("noArgs", listener);
      emitter.emit("noArgs");

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith();
    });
  });

  describe("off", () => {
    it("should remove a specific listener", () => {
      const listener1 = mock((_value: string) => {});
      const listener2 = mock((_value: string) => {});

      emitter.on("test", listener1);
      emitter.on("test", listener2);
      emitter.off("test", listener1);
      emitter.emit("test", "hello");

      expect(listener1).toHaveBeenCalledTimes(0);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it("should do nothing when removing a non-existent listener", () => {
      const listener1 = mock((_value: string) => {});
      const listener2 = mock((_value: string) => {});

      emitter.on("test", listener1);
      emitter.off("test", listener2); // listener2 was never registered
      emitter.emit("test", "hello");

      expect(listener1).toHaveBeenCalledTimes(1);
    });
  });

  describe("once", () => {
    it("should trigger a listener only once", () => {
      const listener = mock((_value: string) => {});

      emitter.once("test", listener);
      emitter.emit("test", "first");
      emitter.emit("test", "second");

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith("first");
    });

    it("should handle multiple once listeners", () => {
      const listener1 = mock((_value: string) => {});
      const listener2 = mock((_value: string) => {});

      emitter.once("test", listener1);
      emitter.once("test", listener2);
      emitter.emit("test", "hello");

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it("should not drop a once listener added re-entrantly during emit", () => {
      const added = mock((_value: string) => {});
      emitter.once("test", () => {
        // Re-subscribe a once listener while dispatching the same event.
        emitter.once("test", added);
      });

      emitter.emit("test", "first");
      // The re-entrantly added listener must not fire during the first emit...
      expect(added).toHaveBeenCalledTimes(0);

      emitter.emit("test", "second");
      // ...but must survive and fire exactly once on the next emit.
      expect(added).toHaveBeenCalledTimes(1);
      expect(added).toHaveBeenCalledWith("second");
    });
  });

  describe("removeAllListeners", () => {
    it("should remove all listeners for a specific event", () => {
      const testListener = mock((_value: string) => {});
      const multipleArgsListener = mock((_arg1: string, _arg2: number, _arg3: boolean) => {});

      emitter.on("test", testListener);
      emitter.on("multipleArgs", multipleArgsListener);

      emitter.removeAllListeners("test");

      emitter.emit("test", "hello");
      emitter.emit("multipleArgs", "test", 42, true);

      expect(testListener).toHaveBeenCalledTimes(0);
      expect(multipleArgsListener).toHaveBeenCalledTimes(1);
    });

    it("should not resurrect an event cleared by a listener during emit", () => {
      const onceListener = mock((_value: string) => {});
      emitter.once("test", () => {
        emitter.removeAllListeners("test");
      });
      emitter.once("test", onceListener);

      emitter.emit("test", "hello");

      // The clearing listener tore down the event mid-dispatch; the event must
      // stay empty rather than being resurrected by once-listener cleanup.
      expect(emitter.listenerCount("test")).toBe(0);
      expect(emitter.eventNames()).not.toContain("test");
    });

    it("should remove all listeners for all events when no event is specified", () => {
      const testListener = mock((_value: string) => {});
      const multipleArgsListener = mock((_arg1: string, _arg2: number, _arg3: boolean) => {});

      emitter.on("test", testListener);
      emitter.on("multipleArgs", multipleArgsListener);

      emitter.removeAllListeners();

      emitter.emit("test", "hello");
      emitter.emit("multipleArgs", "test", 42, true);

      expect(testListener).toHaveBeenCalledTimes(0);
      expect(multipleArgsListener).toHaveBeenCalledTimes(0);
    });
  });

  describe("error handling", () => {
    it("should throw a single listener error directly", () => {
      const error = new Error("listener failed");
      emitter.on("test", () => {
        throw error;
      });

      expect(() => emitter.emit("test", "hello")).toThrow(error);
    });

    it("should throw AggregateError when multiple listeners throw", () => {
      const error1 = new Error("first");
      const error2 = new Error("second");
      emitter.on("test", () => {
        throw error1;
      });
      emitter.on("test", () => {
        throw error2;
      });

      try {
        emitter.emit("test", "hello");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AggregateError);
        const agg = e as AggregateError;
        expect(agg.errors).toHaveLength(2);
        expect(agg.errors[0]).toBe(error1);
        expect(agg.errors[1]).toBe(error2);
        expect(agg.message).toContain("2 listener(s) threw");
      }
    });

    it("should call all listeners even when earlier ones throw", () => {
      const listener1 = mock(() => {
        throw new Error("fail");
      });
      const listener2 = mock((_value: string) => {});

      emitter.on("test", listener1);
      emitter.on("test", listener2);

      expect(() => emitter.emit("test", "hello")).toThrow();
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe("emitted", () => {
    it("should return a promise that resolves when the event is emitted with an array containing the argument", async () => {
      const promise = emitter.waitOn("test");
      emitter.emit("test", "hello");

      const result = await promise;
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(["hello"]);
    });

    it("should handle events with multiple arguments and return all arguments as an array", async () => {
      const promise = emitter.waitOn("multipleArgs");
      emitter.emit("multipleArgs", "test", 42, true);

      const result = await promise;
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(["test", 42, true]);
    });

    it("should handle events with no arguments and return an empty array", async () => {
      const promise = emitter.waitOn("noArgs");
      emitter.emit("noArgs");

      const result = await promise;
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([]);
    });
  });
});
