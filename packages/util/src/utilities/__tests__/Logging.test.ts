/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConsoleLogger, NullLogger, getLogger, setLogger } from "@workglow/util";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("NullLogger", () => {
  it("should not throw on any method call", () => {
    const logger = new NullLogger();
    expect(() => logger.info("test")).not.toThrow();
    expect(() => logger.warn("test")).not.toThrow();
    expect(() => logger.error("test")).not.toThrow();
    expect(() => logger.debug("test")).not.toThrow();
    expect(() => logger.fatal(new Error("test"), "test")).not.toThrow();
    expect(() => logger.time("test")).not.toThrow();
    expect(() => logger.timeEnd("test")).not.toThrow();
    expect(() => logger.group("test")).not.toThrow();
    expect(() => logger.groupEnd()).not.toThrow();
  });

  it("should return itself from child()", () => {
    const logger = new NullLogger();
    const child = logger.child({ component: "test" });
    expect(child).toBe(logger);
  });
});

describe("ConsoleLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should log info messages", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = new ConsoleLogger({ level: "debug" });
    logger.info("hello");
    expect(spy).toHaveBeenCalledWith("hello");
  });

  it("should log warn messages", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = new ConsoleLogger({ level: "debug" });
    logger.warn("warning");
    expect(spy).toHaveBeenCalledWith("warning");
  });

  it("should log error messages", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new ConsoleLogger({ level: "debug" });
    logger.error("err");
    expect(spy).toHaveBeenCalledWith("err");
  });

  it("should log debug messages", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const logger = new ConsoleLogger({ level: "debug" });
    logger.debug("dbg");
    expect(spy).toHaveBeenCalledWith("dbg");
  });

  it("should filter messages below configured level", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = new ConsoleLogger({ level: "warn" });
    logger.debug("should not appear");
    logger.info("should not appear");
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("should allow messages at or above configured level", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new ConsoleLogger({ level: "warn" });
    logger.warn("warning");
    logger.error("error");
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("should include metadata when provided", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = new ConsoleLogger({ level: "debug" });
    logger.info("test", { key: "value" });
    expect(spy).toHaveBeenCalledWith("test", { key: "value" });
  });

  it("should merge bindings with metadata", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = new ConsoleLogger({ level: "debug", bindings: { component: "auth" } });
    logger.info("test", { key: "value" });
    expect(spy).toHaveBeenCalledWith("test", { component: "auth", key: "value" });
  });

  it("should create child logger with inherited bindings", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const parent = new ConsoleLogger({ level: "debug", bindings: { app: "test" } });
    const child = parent.child({ module: "auth" });
    (child as ConsoleLogger).info("hello");
    expect(spy).toHaveBeenCalledWith("hello", { app: "test", module: "auth" });
  });

  it("should handle group and groupEnd", () => {
    const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
    const groupEndSpy = vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    const logger = new ConsoleLogger();
    logger.group("test group");
    logger.groupEnd();
    expect(groupSpy).toHaveBeenCalledWith("test group");
    expect(groupEndSpy).toHaveBeenCalled();
  });

  it("should not output time/timeEnd when timings disabled", () => {
    const timeSpy = vi.spyOn(console, "time").mockImplementation(() => {});
    const logger = new ConsoleLogger({ timings: false });
    logger.time("label");
    logger.timeEnd("label");
    expect(timeSpy).not.toHaveBeenCalled();
  });

  it("should output time/timeEnd when timings enabled", () => {
    const timeSpy = vi.spyOn(console, "time").mockImplementation(() => {});
    const timeEndSpy = vi.spyOn(console, "timeEnd").mockImplementation(() => {});
    const logger = new ConsoleLogger({ timings: true });
    logger.time("label");
    logger.timeEnd("label");
    expect(timeSpy).toHaveBeenCalled();
    expect(timeEndSpy).toHaveBeenCalled();
  });

  it("should log fatal with error object", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new ConsoleLogger({ level: "debug" });
    const err = new Error("boom");
    logger.fatal(err, "fatal error");
    expect(spy).toHaveBeenCalledWith("fatal error", { error: err });
  });
});

describe("getLogger / setLogger", () => {
  it("should return a logger", () => {
    const logger = getLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });

  it("should allow setting and getting a custom logger", () => {
    const original = getLogger();
    const custom = new NullLogger();
    setLogger(custom);
    expect(getLogger()).toBe(custom);
    // Restore
    setLogger(original);
  });
});
