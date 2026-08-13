/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JsonValue } from "@workglow/util/schema";
import { createPartialJsonStream, parsePartialJson } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

/** Documents covering nesting, arrays, escapes, unicode, numbers and literals. */
const DOCS: readonly string[] = [
  '{"name":"Alice","age":30}',
  "{}",
  '{"a":{"b":{"c":[1,2,3]}}}',
  '{"s":"he said \\"hi\\"\\n\\t","u":"\\u0041\\u00e9"}',
  '{"nums":[0,-1,1.5,2e3,-4.25e-2,1e+5]}',
  '{"t":true,"f":false,"n":null}',
  '{"empty":{},"earr":[],"nested":[[],{},[{}]]}',
  '{"deep":{"a":[{"b":[{"c":"d"}]}]}}',
  '{"emoji":"\\ud83d\\ude00 ok","esc":"a\\\\b\\/c"}',
  '{"mixed":[1,"two",true,null,{"k":[]},[3]]}',
  '{"pretty": {\n  "x": 1,\n  "y": [ 2, 3 ]\n}}',
];

function pushAll(chunks: readonly string[], skipPreamble = false): JsonValue {
  const stream = createPartialJsonStream(skipPreamble ? { skipPreamble: true } : {});
  for (const chunk of chunks) stream.push(chunk);
  return stream.finish();
}

describe("createPartialJsonStream", () => {
  describe("chunk boundaries", () => {
    it("reassembles every document across every single-character split point", () => {
      for (const doc of DOCS) {
        const expected = JSON.parse(doc);
        for (let split = 0; split <= doc.length; split++) {
          const got = pushAll([doc.slice(0, split), doc.slice(split)]);
          expect(got, `doc ${doc} split at ${split}`).toEqual(expected);
        }
      }
    });

    it("reassembles every document fed one character at a time", () => {
      for (const doc of DOCS) {
        expect(pushAll([...doc]), doc).toEqual(JSON.parse(doc));
      }
    });

    it("reports `complete` only once the root value closes", () => {
      const stream = createPartialJsonStream();
      stream.push('{"a":1');
      expect(stream.complete).toBe(false);
      stream.push("}");
      expect(stream.complete).toBe(true);
    });

    it("ignores trailing content after the root value closes", () => {
      expect(pushAll(['{"a":1}', "trailing noise {"])).toEqual({ a: 1 });
    });
  });

  describe("split escapes", () => {
    it("handles an escaped quote split across chunks", () => {
      expect(pushAll(['{"k":"a\\', '"b"}'])).toEqual({ k: 'a"b' });
    });

    it("handles a unicode escape split across chunks", () => {
      expect(pushAll(['{"k":"\\u00', '41"}'])).toEqual({ k: "A" });
    });

    it("handles a unicode escape split at every internal boundary", () => {
      const doc = '{"k":"\\u0041\\u00e9"}';
      for (let split = 0; split <= doc.length; split++) {
        expect(pushAll([doc.slice(0, split), doc.slice(split)])).toEqual({ k: "Aé" });
      }
    });

    it("handles a backslash escape at a chunk edge", () => {
      expect(pushAll(['{"k":"a\\', '\\b"}'])).toEqual({ k: "a\\b" });
    });

    it("keeps an invalid unicode escape verbatim, digits included", () => {
      expect(pushAll(['{"k":"\\u00zz"}'])).toEqual({ k: "\\u00zz" });
      expect(pushAll(['{"k":"\\u00', 'zz"}'])).toEqual({ k: "\\u00zz" });
    });

    it("reassembles a surrogate pair split across chunks", () => {
      expect(pushAll(['{"k":"\\ud83d', '\\ude00"}'])).toEqual({ k: "😀" });
    });
  });

  describe("split scalars", () => {
    it("reassembles a number split across three chunks", () => {
      expect(pushAll(['{"n":1.', "5e", "-3}"])).toEqual({ n: 1.5e-3 });
    });

    it("reassembles `true` split across chunks", () => {
      expect(pushAll(['{"b":tr', "ue}"])).toEqual({ b: true });
    });

    it("reassembles `null` split across chunks", () => {
      expect(pushAll(['{"z":nul', "l}"])).toEqual({ z: null });
    });

    it("reassembles a negative exponent number terminated by end of stream", () => {
      expect(pushAll(['{"n":-4.25e', "-2"])).toEqual({ n: -0.0425 });
    });
  });

  describe("truncated streams", () => {
    it("closes open containers on finish", () => {
      expect(pushAll(['{"a":1,"b":{"c":[1,2'])).toEqual({ a: 1, b: { c: [1, 2] } });
    });

    it("keeps a partially received string value", () => {
      expect(pushAll(['{"name":"Ali'])).toEqual({ name: "Ali" });
    });

    it("drops a trailing incomplete literal, matching parsePartialJson", () => {
      expect(pushAll(['{"a": tru'])).toEqual({});
      expect(pushAll(['{"flag": fal'])).toEqual({});
      expect(pushAll(['{"x": nul'])).toEqual({});
    });

    it("drops a trailing incomplete number but keeps a complete one", () => {
      expect(pushAll(['{"n": 1.'])).toEqual({});
      expect(pushAll(['{"n": 30'])).toEqual({ n: 30 });
    });

    it("drops a trailing partial key", () => {
      expect(pushAll(['{"a":1,"bc'])).toEqual({ a: 1 });
    });

    it("tolerates a trailing comma", () => {
      expect(pushAll(['{"name":"Alice",'])).toEqual({ name: "Alice" });
    });

    it("is idempotent", () => {
      const stream = createPartialJsonStream();
      stream.push('{"a":[1,2');
      const first = stream.finish();
      expect(stream.finish()).toEqual(first);
      expect(stream.finish()).toEqual({ a: [1, 2] });
    });

    it("returns an empty object when nothing was ever parsed", () => {
      expect(pushAll([""])).toEqual({});
      expect(pushAll(["   "])).toEqual({});
    });

    it("does not let a stray close at the root end the document", () => {
      // Popping the empty stack would mark the stream `complete` with an
      // undefined root, so everything after the stray brace is discarded.
      const stream = createPartialJsonStream();
      stream.push('}{"a":1}');
      expect(stream.complete).toBe(false);
      expect(stream.finish()).toEqual({});

      const bracket = createPartialJsonStream();
      bracket.push("]");
      expect(bracket.complete).toBe(false);
    });
  });

  describe("preamble skipping", () => {
    it("discards prose before the JSON object", () => {
      expect(pushAll(['Here you go: {"a":1}'], true)).toEqual({ a: 1 });
    });

    it("discards prose split across chunks and trailing commentary", () => {
      expect(pushAll(["Sure! Here ", 'you go: {"a":1}', " Hope that helps."], true)).toEqual({
        a: 1,
      });
    });

    it("discards a <think> block prefix", () => {
      expect(pushAll(["<think>Let me reason first.</think>", '{"ok":true}'], true)).toEqual({
        ok: true,
      });
    });

    it("recovers when a <think> block itself contains braces", () => {
      // Prose braces open a candidate that immediately fails to parse. Because it
      // never yielded any data it is discarded and scanning resumes, so the real
      // payload is still found.
      expect(pushAll(['<think>I should use {braces}</think>{"ok":true}'], true)).toEqual({
        ok: true,
      });
    });

    it("discards a markdown code fence", () => {
      expect(pushAll(['```json\n{"a":1}\n```'], true)).toEqual({ a: 1 });
    });

    it("does not mistake a bracketed aside in the prose for the payload", () => {
      // A citation marker parses as a complete array; locking onto it would
      // close the root and throw away the real object behind it.
      expect(pushAll(['See [1] for details. {"ok":true}'], true)).toEqual({ ok: true });
      // An array that stays open until non-JSON prose is worse: its non-empty
      // root would make the failure unrecoverable.
      expect(pushAll(['Based on [2024 figures], here it is: {"ok":true}'], true)).toEqual({
        ok: true,
      });
    });

    it("emits nothing for text containing no JSON", () => {
      const stream = createPartialJsonStream({ skipPreamble: true });
      expect(stream.push("no json here")).toBeUndefined();
      expect(stream.finish()).toEqual({});
    });

    it("does not skip preamble unless asked", () => {
      const stream = createPartialJsonStream();
      expect(stream.push('Here you go: {"a":1}')).toBeUndefined();
    });
  });

  describe("preamble skipping: last complete object wins", () => {
    it("prefers the payload over a complete object inside a <think> block", () => {
      // A thinking model that restates the schema emits a syntactically valid
      // object before the answer. Latching onto it silently returns the wrong
      // document — and reports `complete`, so nothing downstream notices.
      expect(
        pushAll(
          ['<think>the schema is {"type":"object"} so I will emit</think>{"name":"Bob"}'],
          true
        )
      ).toEqual({ name: "Bob" });
    });

    it("prefers the payload over a schema-shaped few-shot example", () => {
      // The worst case: the preamble object validates against the same schema
      // as the payload, so a re-validating consumer accepts and persists it.
      expect(pushAll(['<think>e.g. {"name":"Alice"}</think>{"name":"Bob"}'], true)).toEqual({
        name: "Bob",
      });
    });

    it("keeps the last complete object when trailing prose braces fail", () => {
      const stream = createPartialJsonStream({ skipPreamble: true });
      stream.push('{"ok":true} note: {not json}');
      expect(stream.finish()).toEqual({ ok: true });
      expect(stream.complete).toBe(true);
    });

    it("keeps the completed payload when a restarted candidate is truncated", () => {
      // The restart produced no data, so the completed candidate stands.
      expect(pushAll(['{"ok":true} then {'], true)).toEqual({ ok: true });
    });

    it("prefers a restarted candidate that carries data over the completed one", () => {
      // Data in flight outranks an earlier complete object: it is the later,
      // genuinely truncated payload rather than prose.
      const stream = createPartialJsonStream({ skipPreamble: true });
      stream.push('{"ok":true} then {"name":"Bo');
      expect(stream.finish()).toEqual({ name: "Bo" });
      expect(stream.complete).toBe(false);
    });

    it("restarting a candidate replaces the emitted delta", () => {
      // Object deltas are folded with replace semantics, so the fresh empty
      // root the restart returns resets the consumer's accumulator; the
      // abandoned object never has to be retracted.
      const stream = createPartialJsonStream({ skipPreamble: true });
      expect(stream.push('<think>{"name":"Ali')).toEqual({ name: "Ali" });
      // Closing the prose candidate retires it: nothing is live to emit.
      expect(stream.push('ce"}</think>')).toBeUndefined();
      // The chunk carrying the real `{` opens a fresh root, which replaces it.
      expect(stream.push('{"name"')).toEqual({});
      expect(stream.push(':"Bob"}')).toBeUndefined();
      expect(stream.finish()).toEqual({ name: "Bob" });
    });

    it("still reports `complete` false when no candidate ever closed", () => {
      const stream = createPartialJsonStream({ skipPreamble: true });
      stream.push('prose {"a":1');
      expect(stream.complete).toBe(false);
      expect(stream.finish()).toEqual({ a: 1 });
    });
  });

  describe("finish() typing", () => {
    it("is typed as JsonValue for an array root", () => {
      const stream = createPartialJsonStream();
      stream.push("[1,2,3]");
      const value = stream.finish();
      expect(Array.isArray(value)).toBe(true);
      expect(value).toEqual([1, 2, 3]);
      // @ts-expect-error finish() is a JsonValue, so object-style use of an
      // array or scalar root no longer type-checks silently.
      const keys: string[] = Object.keys(stream.finish());
      // The runtime behavior is unchanged and deliberately still wrong-looking,
      // which is precisely why the compile error above matters.
      expect(keys).toEqual(["0", "1", "2"]);
    });

    it("finishObject() returns {} for an array root", () => {
      const stream = createPartialJsonStream();
      stream.push("[1,2,3]");
      expect(stream.finishObject()).toEqual({});
    });

    it("finishObject() returns {} for a scalar root but keeps an object root", () => {
      const scalar = createPartialJsonStream();
      scalar.push('"abc"');
      expect(scalar.finishObject()).toEqual({});

      const object = createPartialJsonStream();
      object.push('{"a":1}');
      expect(object.finishObject()).toEqual({ a: 1 });
    });

    it("complete is false for a truncated scalar root", () => {
      // End-of-stream repair commits the unterminated string; that is not the
      // document closing on its own.
      const stream = createPartialJsonStream();
      stream.push('"abc');
      expect(stream.finish()).toBe("abc");
      expect(stream.complete).toBe(false);
    });
  });

  describe("live root and snapshot", () => {
    it("returns undefined until a top-level object opens", () => {
      const stream = createPartialJsonStream();
      expect(stream.push("  ")).toBeUndefined();
      expect(stream.push("{")).toEqual({});
    });

    it("returns undefined for a top-level array, matching parsePartialJson", () => {
      const stream = createPartialJsonStream();
      expect(stream.push("[1,2,3]")).toBeUndefined();
      expect(parsePartialJson("[1,2,3]")).toBeUndefined();
      // finish() still yields the parsed document, as JSON.parse would.
      expect(stream.finish()).toEqual([1, 2, 3]);
    });

    it("returns the live root, which later pushes mutate", () => {
      const stream = createPartialJsonStream();
      const first = stream.push('{"a":1');
      stream.push(',"b":2}');
      // Documented aliasing: the retained delta is the same object, now grown.
      expect(first).toEqual({ a: 1, b: 2 });
    });

    it("snapshot() detaches a copy that later pushes do not mutate", () => {
      const stream = createPartialJsonStream();
      stream.push('{"a":1');
      const snap = stream.snapshot();
      stream.push(',"b":2}');
      expect(snap).toEqual({ a: 1 });
      expect(stream.finish()).toEqual({ a: 1, b: 2 });
    });

    it("snapshot() returns undefined when there is no object root yet", () => {
      expect(createPartialJsonStream().snapshot()).toBeUndefined();
    });

    it("creates __proto__ as an own property without polluting Object.prototype", () => {
      const result = pushAll(['{"__proto__":{"polluted":1},"x":2}']) as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(true);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(result.x).toBe(2);
    });
  });

  describe("equivalence with parsePartialJson", () => {
    // Prefixes ending in whitespace are excluded: parsePartialJson trims its
    // input, so `{"s":"he ` loses the space inside the in-flight string value
    // while the stream preserves it. That divergence is asserted on its own below.
    it("agrees at every prefix where parsePartialJson produces a result", () => {
      for (const doc of DOCS) {
        for (let n = 1; n <= doc.length; n++) {
          const prefix = doc.slice(0, n);
          if (/\s$/.test(prefix)) continue;
          const oneShot = parsePartialJson(prefix);
          if (oneShot === undefined) continue;
          const stream = createPartialJsonStream();
          stream.push(prefix);
          expect(stream.snapshot(), `prefix ${JSON.stringify(prefix)}`).toEqual(oneShot);
        }
      }
    });

    it("never loses a result that parsePartialJson would have produced", () => {
      for (const doc of DOCS) {
        for (let n = 1; n <= doc.length; n++) {
          const prefix = doc.slice(0, n);
          if (/\s$/.test(prefix)) continue;
          if (parsePartialJson(prefix) === undefined) continue;
          const stream = createPartialJsonStream();
          expect(stream.push(prefix), `prefix ${JSON.stringify(prefix)}`).toBeDefined();
        }
      }
    });

    it("diverges by keeping the object built so far while a key is in flight", () => {
      // parsePartialJson discards the whole object; the stream keeps what it has.
      expect(parsePartialJson('{"name":"Alice","ag')).toBeUndefined();
      const stream = createPartialJsonStream();
      expect(stream.push('{"name":"Alice","ag')).toEqual({ name: "Alice" });
    });

    it("diverges by preserving trailing whitespace inside an in-flight string", () => {
      expect(parsePartialJson('{"s":"he ')).toEqual({ s: "he" });
      const stream = createPartialJsonStream();
      expect(stream.push('{"s":"he ')).toEqual({ s: "he " });
    });
  });

  describe("performance", () => {
    it("parses 100 KB in 40-character chunks in linear time", () => {
      const items: unknown[] = [];
      let size = 0;
      while (size < 110_000) {
        const item = {
          id: items.length,
          name: `entity number ${items.length}`,
          tags: ["alpha", "beta"],
          score: items.length * 1.5,
          ok: items.length % 2 === 0,
        };
        size += JSON.stringify(item).length + 1;
        items.push(item);
      }
      const doc = JSON.stringify({ items });
      expect(doc.length).toBeGreaterThan(100_000);

      const started = performance.now();
      const stream = createPartialJsonStream();
      for (let i = 0; i < doc.length; i += 40) {
        stream.push(doc.slice(i, i + 40));
      }
      const result = stream.finish();
      const elapsed = performance.now() - started;

      expect(result).toEqual(JSON.parse(doc));
      // Re-parsing the growing buffer on every chunk takes multiple seconds here.
      // The bound is deliberately loose so only an algorithmic regression trips it.
      expect(elapsed).toBeLessThan(250);
    });
  });
});
