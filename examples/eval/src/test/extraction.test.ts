/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { buildExtractPrompt, parseExpectedRows, resolveExtractionFields } from "../evals/extract";
import { fenceText } from "../evals/prompt";
import { aggregateResults } from "../report/aggregate";
import { combineExtractionCounts, scoreExtraction } from "../score/extraction";
import type { EvalResultRecord } from "../storage";

describe("scoreExtraction", () => {
  const expected = [
    { name: "Alice Chen", title: "CEO" },
    { name: "Bob Osei", title: "CTO" },
  ];

  it("scores a perfect extraction as 1/1/1", () => {
    const s = scoreExtraction(expected, expected, "name");
    expect(s.score).toBe(1);
    expect(s.found).toBe(1);
    expect(s.prec).toBe(1);
  });

  it("aligns by normalized key and scores field agreement", () => {
    const candidate = [
      { name: "alice chen", title: "Chief Executive Officer" },
      { name: "Bob Osei", title: "CTO" },
    ];
    const s = scoreExtraction(candidate, expected, "name");
    expect(s.found).toBe(1); // both entities found
    expect(s.prec).toBe(1); // no hallucinated rows
    // 2 scored fields (title per entity — the key is alignment, not agreement),
    // and Alice's title disagrees
    expect(s.score).toBeCloseTo(1 / 2);
  });

  it("counts missing entities against recall and invented rows against precision", () => {
    const candidate = [
      { name: "Alice Chen", title: "CEO" },
      { name: "Zed Nobody", title: "CFO" },
    ];
    const s = scoreExtraction(candidate, expected, "name");
    expect(s.found).toBeCloseTo(1 / 2);
    expect(s.prec).toBeCloseTo(1 / 2);
  });

  it("computes precision over distinct rows so duplicates are not hallucinations", () => {
    const candidate = [
      { name: "Alice Chen", title: "CEO" },
      { name: "Alice Chen", title: "CEO" },
      { name: "Bob Osei", title: "CTO" },
    ];
    const s = scoreExtraction(candidate, expected, "name");
    expect(s.candidateDistinct).toBe(2);
    expect(s.prec).toBe(1);
  });

  it("limits scoring to the requested fields", () => {
    const candidate = [{ name: "Alice Chen", title: "CEO", extra: "mismatch" }];
    const s = scoreExtraction(candidate, [{ ...expected[0], extra: "gold" }], "name", ["title"]);
    expect(s.score).toBe(1); // "extra" disagrees but is not requested
  });

  it("never scores the key field itself", () => {
    const candidate = [{ name: "Alice Chen" }];
    const s = scoreExtraction(candidate, [{ name: "Alice Chen" }], "name", ["name"]);
    expect(s.found).toBe(1);
    expect(s.score).toBeNaN(); // a matched pair agrees on the key by construction
  });

  it("compares structured field values by content, not object identity", () => {
    const gold = [{ name: "A", tags: ["x", "y"] }];
    const same = scoreExtraction([{ name: "A", tags: ["x", "y"] }], gold, "name");
    const different = scoreExtraction([{ name: "A", tags: ["z"] }], gold, "name");
    expect(same.score).toBe(1);
    expect(different.score).toBe(0);
  });

  it("is NaN-safe on empty inputs", () => {
    const s = scoreExtraction([], [], "name");
    expect(s.score).toBeNaN();
    expect(s.found).toBeNaN();
    expect(s.prec).toBeNaN();
  });
});

describe("combineExtractionCounts", () => {
  it("micro-averages counts across rows", () => {
    const a = scoreExtraction([{ name: "A" }], [{ name: "A" }, { name: "B" }], "name");
    const b = scoreExtraction([{ name: "C" }], [{ name: "C" }], "name");
    const combined = combineExtractionCounts([a, b]);
    expect(combined.found).toBeCloseTo(2 / 3);
    expect(combined.prec).toBe(1);
  });
});

describe("parseExpectedRows", () => {
  it("accepts arrays of objects and JSON strings", () => {
    expect(parseExpectedRows([{ name: "A" }], "expected")).toEqual([{ name: "A" }]);
    expect(parseExpectedRows('[{"name":"A"}]', "expected")).toEqual([{ name: "A" }]);
  });

  it("rejects non-array gold values and non-object elements", () => {
    expect(() => parseExpectedRows({ name: "A" }, "expected")).toThrow(/array of objects/);
    expect(() => parseExpectedRows([["A"]], "expected")).toThrow(/array of objects/);
    expect(() => parseExpectedRows(["A"], "expected")).toThrow(/array of objects/);
    expect(() => parseExpectedRows("not json", "expected")).toThrow();
  });
});

describe("resolveExtractionFields", () => {
  it("derives fields from gold rows, always including the key", () => {
    expect(
      resolveExtractionFields([{ name: "A", role: "x" }, { org: "Y" }], "name", undefined)
    ).toEqual(["name", "role", "org"]);
  });

  it("prepends the key field to an explicit list when missing", () => {
    expect(resolveExtractionFields([], "name", ["role"])).toEqual(["name", "role"]);
  });

  it("drops prototype-polluting field names", () => {
    expect(resolveExtractionFields([{ name: "A", ["__proto__"]: "x" }], "name", undefined)).toEqual(
      ["name"]
    );
    expect(resolveExtractionFields([], "name", ["__proto__", "role"])).toEqual(["name", "role"]);
    expect(() => resolveExtractionFields([], "__proto__", undefined)).toThrow(/key-field/);
  });
});

describe("buildExtractPrompt", () => {
  it("names the fields, the key, and fences the text", () => {
    const prompt = buildExtractPrompt("Some text.", "Extract people.", "name", ["name", "role"]);
    expect(prompt).toContain("Extract people.");
    expect(prompt).toContain("name, role");
    expect(prompt).toContain('"""\nSome text.\n"""');
  });
});

describe("fenceText", () => {
  it("wraps text in a triple-quote fence", () => {
    expect(fenceText("hello")).toBe('"""\nhello\n"""');
  });

  it("grows the fence when the text contains the delimiter", () => {
    const fenced = fenceText('end """ and """" more');
    expect(fenced.startsWith('"""""\n')).toBe(true);
    expect(fenced.endsWith('\n"""""')).toBe(true);
  });
});

describe("aggregateResults for extract runs", () => {
  function result(model: string, expected: unknown, predicted: unknown): EvalResultRecord {
    return {
      run_id: "r1",
      model,
      row_index: 0,
      ok: 1,
      error: null,
      expected: JSON.stringify(expected),
      predicted: JSON.stringify(predicted),
      expected_value: null,
      predicted_value: null,
      latency_ms: 100,
    };
  }

  it("re-scores stored row JSON and ranks by field agreement", () => {
    const gold = [{ name: "Alice", role: "CEO" }];
    const results = [
      result("good", gold, gold),
      result("bad", gold, [{ name: "Alice", role: "janitor" }]),
    ];
    const reports = aggregateResults("extract", results, { keyField: "name" });
    expect(reports.map((r) => r.model)).toEqual(["good", "bad"]);
    expect(reports[0].score).toBe(1);
    expect(reports[0].found).toBe(1);
    expect(reports[1].score).toBe(0); // the only non-key field disagrees
  });

  it("ranks a model with unscored fields by recall instead of tying at the bottom", () => {
    const gold = [{ name: "Alice", role: "CEO" }];
    const results = [
      // Matched the entity (score NaN — key-only rows leave nothing to score).
      result("recalls", [{ name: "Alice" }], [{ name: "Alice" }]),
      // Found nothing at all.
      result("empty", gold, []),
    ];
    const reports = aggregateResults("extract", results, { keyField: "name" });
    expect(reports.map((r) => r.model)).toEqual(["recalls", "empty"]);
  });
});
