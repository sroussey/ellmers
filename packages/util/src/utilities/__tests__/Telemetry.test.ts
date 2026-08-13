/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConsoleTelemetryProvider, NoopTelemetryProvider, SpanStatusCode } from "@workglow/util";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("NoopTelemetryProvider", () => {
  it("isEnabled should be false", () => {
    const provider = new NoopTelemetryProvider();
    expect(provider.isEnabled).toBe(false);
  });

  it("startSpan should return a span that does nothing", () => {
    const provider = new NoopTelemetryProvider();
    const span = provider.startSpan("test.span");
    // Should not throw
    span.setAttributes({ key: "value" });
    span.addEvent("event");
    span.setStatus(SpanStatusCode.OK);
    span.end();
  });
});

describe("ConsoleTelemetryProvider", () => {
  let provider: ConsoleTelemetryProvider;

  beforeEach(() => {
    provider = new ConsoleTelemetryProvider();
  });

  it("isEnabled should be true", () => {
    expect(provider.isEnabled).toBe(true);
  });

  it("startSpan should return a span", () => {
    const span = provider.startSpan("test.span");
    expect(span).toBeDefined();
    expect(span.end).toBeInstanceOf(Function);
    expect(span.setAttributes).toBeInstanceOf(Function);
    expect(span.addEvent).toBeInstanceOf(Function);
    expect(span.setStatus).toBeInstanceOf(Function);
  });

  describe("ConsoleSpan", () => {
    it("should log to console.debug for OK spans", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      try {
        const span = provider.startSpan("test.ok");
        span.setStatus(SpanStatusCode.OK);
        span.end();

        expect(debugSpy).toHaveBeenCalledOnce();
        const output = debugSpy.mock.calls[0][0] as string;
        expect(output).toContain("[telemetry] test.ok");
        expect(output).toContain("status: OK");
      } finally {
        debugSpy.mockRestore();
      }
    });

    it("should log to console.error for ERROR spans", () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const span = provider.startSpan("test.error");
        span.setStatus(SpanStatusCode.ERROR, "something went wrong");
        span.end();

        expect(errorSpy).toHaveBeenCalledOnce();
        const output = errorSpy.mock.calls[0][0] as string;
        expect(output).toContain("[telemetry] test.error");
        expect(output).toContain("status: ERROR - something went wrong");
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("should log to console.debug for UNSET status (no status line)", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      try {
        const span = provider.startSpan("test.unset");
        span.end();

        expect(debugSpy).toHaveBeenCalledOnce();
        const output = debugSpy.mock.calls[0][0] as string;
        expect(output).toContain("[telemetry] test.unset");
        expect(output).not.toContain("status:");
      } finally {
        debugSpy.mockRestore();
      }
    });

    it("should include duration in ms", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      try {
        const span = provider.startSpan("test.duration");
        span.end();

        const output = debugSpy.mock.calls[0][0] as string;
        expect(output).toMatch(/test\.duration \(\d+\.\d+ms\)/);
      } finally {
        debugSpy.mockRestore();
      }
    });

    it("should include attributes", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      try {
        const span = provider.startSpan("test.attrs", {
          attributes: { "init.key": "init-value" },
        });
        span.setAttributes({ "task.type": "MyTask", "task.id": 42 });
        span.end();

        const output = debugSpy.mock.calls[0][0] as string;
        expect(output).toContain("attributes:");
        expect(output).toContain('"init.key":"init-value"');
        expect(output).toContain('"task.type":"MyTask"');
        expect(output).toContain('"task.id":42');
      } finally {
        debugSpy.mockRestore();
      }
    });

    it("should include events", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      try {
        const span = provider.startSpan("test.events");
        span.addEvent("task.started");
        span.addEvent("task.retry", { attempt: 2 });
        span.end();

        const output = debugSpy.mock.calls[0][0] as string;
        expect(output).toContain("event: task.started");
        expect(output).toContain("event: task.retry");
        expect(output).toContain('"attempt":2');
      } finally {
        debugSpy.mockRestore();
      }
    });

    it("should not include attributes line when none are set", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      try {
        const span = provider.startSpan("test.no-attrs");
        span.end();

        const output = debugSpy.mock.calls[0][0] as string;
        expect(output).not.toContain("attributes:");
      } finally {
        debugSpy.mockRestore();
      }
    });

    it("should merge attributes from options and setAttributes", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
      try {
        const span = provider.startSpan("test.merge", {
          attributes: { a: 1 },
        });
        span.setAttributes({ b: 2 });
        span.setAttributes({ a: 10 }); // override
        span.end();

        const output = debugSpy.mock.calls[0][0] as string;
        expect(output).toContain('"a":10');
        expect(output).toContain('"b":2');
      } finally {
        debugSpy.mockRestore();
      }
    });
  });
});
