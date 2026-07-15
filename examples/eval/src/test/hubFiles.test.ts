/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  parseDatasetFile,
  parseJsonLines,
  sanitizeRow,
  scoreFileForSplit,
  selectSplitFiles,
} from "../hf/hubFiles";

describe("scoreFileForSplit", () => {
  it("prefers exact split file names over shards over directory matches", () => {
    expect(scoreFileForSplit("test.jsonl.gz", "test")).toBe(3);
    expect(scoreFileForSplit("data/test-00000-of-00002.parquet", "test")).toBe(2);
    expect(scoreFileForSplit("plain_text/test/0000.parquet", "test")).toBe(1);
  });

  it("rejects unsupported extensions and unrelated names", () => {
    expect(scoreFileForSplit("README.md", "test")).toBeUndefined();
    expect(scoreFileForSplit("attestation.parquet", "test")).toBeUndefined();
    expect(scoreFileForSplit("train-00000-of-00001.parquet", "test")).toBeUndefined();
  });
});

describe("selectSplitFiles", () => {
  it("selects all shards of the best-matching tier, sorted", () => {
    const files = [
      "README.md",
      "data/train-00000-of-00001.parquet",
      "data/test-00001-of-00002.parquet",
      "data/test-00000-of-00002.parquet",
    ];
    expect(selectSplitFiles(files, "test")).toEqual([
      "data/test-00000-of-00002.parquet",
      "data/test-00001-of-00002.parquet",
    ]);
  });

  it("returns empty when nothing matches", () => {
    expect(selectSplitFiles(["data/train-00000-of-00001.parquet"], "validation")).toEqual([]);
  });
});

describe("sanitizeRow", () => {
  it("converts BigInt values (parquet int64) to numbers", () => {
    expect(sanitizeRow({ text: "hi", label: 3n })).toEqual({ text: "hi", label: 3 });
  });

  it("converts BigInts nested in list and struct columns", () => {
    expect(sanitizeRow({ ids: [1n, 2n], meta: { count: 3n } })).toEqual({
      ids: [1, 2],
      meta: { count: 3 },
    });
    expect(() => JSON.stringify(sanitizeRow({ deep: [{ v: [4n] }] }))).not.toThrow();
  });

  it("preserves int64 values beyond the safe-integer range as decimal strings", () => {
    expect(sanitizeRow({ big: 9007199254740993n, small: 7n })).toEqual({
      big: "9007199254740993",
      small: 7,
    });
    expect(sanitizeRow({ neg: -9007199254740993n })).toEqual({ neg: "-9007199254740993" });
  });

  it("converts Date values (parquet timestamps) to ISO strings", () => {
    expect(sanitizeRow({ at: new Date("2026-01-02T03:04:05Z") })).toEqual({
      at: "2026-01-02T03:04:05.000Z",
    });
  });
});

describe("scoreFileForSplit with unusual split names", () => {
  it("does not throw on regex metacharacters in the split", () => {
    expect(() => scoreFileForSplit("data/train-00000-of-00001.parquet", "c++")).not.toThrow();
    expect(() => scoreFileForSplit("data/train-00000-of-00001.parquet", "a[b")).not.toThrow();
  });

  it("does not treat '.' in a split name as a wildcard", () => {
    expect(scoreFileForSplit("data/tost.parquet", "t.st")).toBeUndefined();
  });
});

describe("parseJsonLines", () => {
  it("parses newline-delimited JSON, skipping blank lines", () => {
    const rows = parseJsonLines('{"a":1}\n\n{"a":2}\n');
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("parseDatasetFile", () => {
  it("parses gzipped jsonl with a row limit", async () => {
    const text = ['{"s1":"a","s2":"b","score":1.5}', '{"s1":"c","s2":"d","score":4.0}'].join("\n");
    const bytes = gzipSync(Buffer.from(text));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const { rows } = await parseDatasetFile("test.jsonl.gz", buffer as ArrayBuffer, 1);
    expect(rows).toEqual([{ s1: "a", s2: "b", score: 1.5 }]);
  });

  it("parses a plain json array", async () => {
    const bytes = new TextEncoder().encode('[{"a":1},{"a":2},{"a":3}]');
    const { rows } = await parseDatasetFile("test.json", bytes.buffer as ArrayBuffer, 2);
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });
});
