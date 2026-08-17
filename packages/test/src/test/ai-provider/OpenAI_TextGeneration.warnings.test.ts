/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  firstNonStrictReason,
  isStrictCompatibleSchema,
  rewriteNullableUnionsForStrict,
} from "@workglow/ai/provider-utils";
import { _testOnly } from "@workglow/openai/ai";
import type { ILogger } from "@workglow/util";
import { setLogger } from "@workglow/util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { _resetOpenAIResponsesWarnings, warnPenaltyDroppedOnce, warnStrictDowngradedOnce } =
  _testOnly;

/**
 * Minimal ILogger that records `warn` calls; other methods are no-ops so the
 * NullLogger-style baseline still applies for anything a subsystem might emit
 * during import.
 */
function makeRecordingLogger(): { logger: ILogger; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  const logger: ILogger = {
    debug: () => {},
    info: () => {},
    warn,
    error: () => {},
    fatal: () => {},
    child: () => logger,
    time: () => {},
    timeEnd: () => {},
    group: () => {},
    groupEnd: () => {},
  };
  return { logger, warn };
}

describe("firstNonStrictReason", () => {
  it("returns undefined for a strict-compatible object schema", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "string" } },
      required: ["a"],
    };
    expect(isStrictCompatibleSchema(schema)).toBe(true);
    expect(firstNonStrictReason(schema)).toBeUndefined();
  });

  it("flags $ref", () => {
    const schema = { $ref: "#/defs/User" };
    expect(isStrictCompatibleSchema(schema)).toBe(false);
    expect(firstNonStrictReason(schema)).toBe("$ref");
  });

  it("flags anyOf", () => {
    const schema = { anyOf: [{ type: "string" }, { type: "number" }] };
    expect(firstNonStrictReason(schema)).toBe("anyOf");
  });

  it("flags oneOf", () => {
    const schema = { oneOf: [{ type: "string" }, { type: "number" }] };
    expect(firstNonStrictReason(schema)).toBe("oneOf");
  });

  it("flags allOf", () => {
    const schema = { allOf: [{ type: "object" }] };
    expect(firstNonStrictReason(schema)).toBe("allOf");
  });

  it("flags missing additionalProperties:false on an object", () => {
    const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
    expect(firstNonStrictReason(schema)).toBe("missing additionalProperties:false");
  });

  it("flags an unlisted required key", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "string" }, b: { type: "string" } },
      required: ["a"],
    };
    expect(firstNonStrictReason(schema)).toBe("unlisted required key: b");
  });

  it("recurses into a non-strict child property", () => {
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        inner: { anyOf: [{ type: "string" }] },
      },
      required: ["inner"],
    };
    expect(firstNonStrictReason(schema)).toBe("inner.anyOf");
  });

  it("recurses into a non-strict array item", () => {
    const schema = {
      type: "array",
      items: { anyOf: [{ type: "string" }] },
    };
    expect(firstNonStrictReason(schema)).toBe("items.anyOf");
  });

  it("recurses into a tuple-shaped array items list", () => {
    const schema = {
      type: "array",
      items: [{ type: "string" }, { anyOf: [{ type: "number" }] }],
    };
    expect(firstNonStrictReason(schema)).toBe("items[1].anyOf");
  });
});

describe("warnPenaltyDroppedOnce dedupe", () => {
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetOpenAIResponsesWarnings();
    const rec = makeRecordingLogger();
    warn = rec.warn;
    setLogger(rec.logger);
  });

  afterEach(() => {
    _resetOpenAIResponsesWarnings();
  });

  it("warns once for frequencyPenalty on the first call and stays silent on repeats", () => {
    warnPenaltyDroppedOnce("gpt-5.5", "frequencyPenalty");
    warnPenaltyDroppedOnce("gpt-5.5", "frequencyPenalty");
    warnPenaltyDroppedOnce("gpt-5.5", "frequencyPenalty");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("frequencyPenalty");
    expect(warn.mock.calls[0][0]).toContain("gpt-5.5");
  });

  it("re-warns when the model changes", () => {
    warnPenaltyDroppedOnce("gpt-5.5", "frequencyPenalty");
    warnPenaltyDroppedOnce("gpt-5.5-mini", "frequencyPenalty");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("frequencyPenalty and presencePenalty dedupe independently", () => {
    warnPenaltyDroppedOnce("gpt-5.5", "frequencyPenalty");
    warnPenaltyDroppedOnce("gpt-5.5", "presencePenalty");
    warnPenaltyDroppedOnce("gpt-5.5", "frequencyPenalty");
    warnPenaltyDroppedOnce("gpt-5.5", "presencePenalty");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("stays silent when neither penalty is warned", () => {
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("warnStrictDowngradedOnce dedupe", () => {
  let warn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetOpenAIResponsesWarnings();
    const rec = makeRecordingLogger();
    warn = rec.warn;
    setLogger(rec.logger);
  });

  afterEach(() => {
    _resetOpenAIResponsesWarnings();
  });

  it("warns once for a schema with anyOf and dedupes on the same model", () => {
    const schema = { anyOf: [{ type: "string" }, { type: "number" }] };
    const reason = firstNonStrictReason(schema)!;
    warnStrictDowngradedOnce("gpt-5.5", reason);
    warnStrictDowngradedOnce("gpt-5.5", reason);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("anyOf");
  });

  it("warns once for an object missing additionalProperties:false", () => {
    const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
    const reason = firstNonStrictReason(schema)!;
    expect(reason).toBe("missing additionalProperties:false");
    warnStrictDowngradedOnce("gpt-5.5", reason);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("missing additionalProperties:false");
  });

  it("does not warn when the schema is strict-compatible (caller-side gate)", () => {
    // The run-fn only calls the helper when isStrictCompatibleSchema is false,
    // so a strict-compatible schema results in zero warn calls.
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: { a: { type: "string" } },
      required: ["a"],
    };
    if (!isStrictCompatibleSchema(schema)) {
      warnStrictDowngradedOnce("gpt-5.5", firstNonStrictReason(schema) ?? "");
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("re-warns when the model changes", () => {
    warnStrictDowngradedOnce("gpt-5.5", "anyOf");
    warnStrictDowngradedOnce("gpt-5.5-mini", "anyOf");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("names the reason inside a nullable object", () => {
    // The run-fn reports on the REWRITTEN schema, where the nullable field is a
    // type array. While `firstNonStrictReason` read only the `"object"` string
    // spelling it returned undefined here and the run-fn logged "unknown
    // reason" — the downshift was observable but not diagnosable.
    const rewritten = rewriteNullableUnionsForStrict({
      type: "object",
      additionalProperties: false,
      required: ["addr"],
      properties: {
        addr: {
          anyOf: [{ type: "object", properties: { city: { type: "string" } } }, { type: "null" }],
        },
      },
    });
    expect(isStrictCompatibleSchema(rewritten)).toBe(false);
    const reason = firstNonStrictReason(rewritten);
    expect(reason).toBe("addr.missing additionalProperties:false");

    warnStrictDowngradedOnce("gpt-5.5", reason!);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("addr.missing additionalProperties:false");
  });

  it("names a multi-type union", () => {
    const rewritten = rewriteNullableUnionsForStrict({
      anyOf: [{ type: ["string", "number"] }, { type: "null" }],
    });
    expect(isStrictCompatibleSchema(rewritten)).toBe(false);
    const reason = firstNonStrictReason(rewritten);
    expect(reason).toBe("multi-type union: string|number|null");

    warnStrictDowngradedOnce("gpt-5.5", reason!);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("multi-type union: string|number|null");
  });
});
