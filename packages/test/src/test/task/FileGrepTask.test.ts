/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileGrepTask, registerSafeFetch, type SafeFetchFn } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const mock = vi.fn;

const mockFetch = mock((_url: string, _options: RequestInit & { allowPrivate?: boolean }) =>
  Promise.resolve(new Response("test", { status: 200 }))
);
const mockSafeFetch: SafeFetchFn = (url, options) => mockFetch(url, options);

const SAMPLE = ["alpha", "bravo foo", "charlie", "FOO delta", "echo foo bar", "foxtrot"].join("\n");

function mockText(content: string): void {
  mockFetch.mockImplementation(() =>
    Promise.resolve(
      new Response(content, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })
    )
  );
}

describe("FileGrepTask", () => {
  const logger = getTestingLogger();
  setLogger(logger);
  let prevSafeFetch: SafeFetchFn;

  beforeAll(() => {
    prevSafeFetch = registerSafeFetch(mockSafeFetch);
  });

  afterAll(() => {
    registerSafeFetch(prevSafeFetch);
  });

  beforeEach(() => {
    mockFetch.mockClear();
    mockText(SAMPLE);
  });

  test("has Document category and FileGrepTask type", () => {
    expect(FileGrepTask.type).toBe("FileGrepTask");
    expect(FileGrepTask.category).toBe("Document");
  });

  test("returns matching lines with 1-based numbers", async () => {
    const result = await new FileGrepTask({
      defaults: { url: "https://example.com/log.txt", pattern: "foo" },
    }).run();

    expect(result.exists).toBe(true);
    expect(result.matchCount).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.groups).toEqual([
      {
        startLine: 2,
        endLine: 2,
        lines: [{ line: 2, text: "bravo foo", match: true }],
      },
      {
        startLine: 5,
        endLine: 5,
        lines: [{ line: 5, text: "echo foo bar", match: true }],
      },
    ]);
  });

  test("returns empty groups when nothing matches", async () => {
    const result = await new FileGrepTask({
      defaults: { url: "https://example.com/log.txt", pattern: "zzz" },
    }).run();

    expect(result).toEqual({
      groups: [],
      matchCount: 0,
      exists: false,
      truncated: false,
    });
  });

  test("ignoreCase matches regardless of case", async () => {
    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        ignoreCase: true,
      },
    }).run();

    expect(result.matchCount).toBe(3);
    expect(
      result.groups.flatMap((g) => g.lines.filter((line) => line.match).map((line) => line.text))
    ).toEqual(["bravo foo", "FOO delta", "echo foo bar"]);
  });

  test("fixedString treats regex metacharacters as literals", async () => {
    mockText("cost is $5.00\ncost is $50\n");

    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "$5.00",
        fixedString: true,
      },
    }).run();

    expect(result.matchCount).toBe(1);
    expect(result.groups[0].lines[0].text).toBe("cost is $5.00");
  });

  test("regex pattern matches without fixedString", async () => {
    mockText("fooXbar\nfoo\nbar\nfoo--bar\n");

    const result = await new FileGrepTask({
      defaults: { url: "https://example.com/log.txt", pattern: "foo.*bar" },
    }).run();

    expect(result.matchCount).toBe(2);
    expect(result.groups.map((g) => g.lines[0].text)).toEqual(["fooXbar", "foo--bar"]);
  });

  test("invertMatch returns lines that do not match", async () => {
    mockText("keep\nskip foo\nkeep too\n");

    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        invertMatch: true,
      },
    }).run();

    expect(result.matchCount).toBe(2);
    expect(result.groups.map((g) => g.lines[0].text)).toEqual(["keep", "keep too"]);
  });

  test("beforeContext includes preceding lines", async () => {
    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "echo foo",
        beforeContext: 1,
      },
    }).run();

    expect(result.groups).toEqual([
      {
        startLine: 4,
        endLine: 5,
        lines: [
          { line: 4, text: "FOO delta", match: false },
          { line: 5, text: "echo foo bar", match: true },
        ],
      },
    ]);
  });

  test("afterContext includes following lines", async () => {
    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "bravo foo",
        afterContext: 1,
      },
    }).run();

    expect(result.groups).toEqual([
      {
        startLine: 2,
        endLine: 3,
        lines: [
          { line: 2, text: "bravo foo", match: true },
          { line: 3, text: "charlie", match: false },
        ],
      },
    ]);
  });

  test("context is both before and after", async () => {
    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "charlie",
        context: 1,
      },
    }).run();

    expect(result.groups).toEqual([
      {
        startLine: 2,
        endLine: 4,
        lines: [
          { line: 2, text: "bravo foo", match: false },
          { line: 3, text: "charlie", match: true },
          { line: 4, text: "FOO delta", match: false },
        ],
      },
    ]);
  });

  test("consecutive matches stay in one group", async () => {
    mockText("alpha\nfoo one\nfoo two\nbravo\n");

    const result = await new FileGrepTask({
      defaults: { url: "https://example.com/log.txt", pattern: "foo" },
    }).run();

    expect(result.groups).toEqual([
      {
        startLine: 2,
        endLine: 3,
        lines: [
          { line: 2, text: "foo one", match: true },
          { line: 3, text: "foo two", match: true },
        ],
      },
    ]);
  });

  test("a match inside afterContext extends the current group", async () => {
    mockText("alpha\nfoo\nbravo\nfoo\ncharlie\n");

    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        afterContext: 2,
      },
    }).run();

    expect(result.groups).toEqual([
      {
        startLine: 2,
        endLine: 5,
        lines: [
          { line: 2, text: "foo", match: true },
          { line: 3, text: "bravo", match: false },
          { line: 4, text: "foo", match: true },
          { line: 5, text: "charlie", match: false },
        ],
      },
    ]);
  });

  test("maxMatches stops after N matching lines", async () => {
    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        maxMatches: 1,
      },
    }).run();

    expect(result.matchCount).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.groups).toEqual([
      {
        startLine: 2,
        endLine: 2,
        lines: [{ line: 2, text: "bravo foo", match: true }],
      },
    ]);
  });

  test("existsOnly returns whether a match exists without groups", async () => {
    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        existsOnly: true,
      },
    }).run();

    expect(result).toEqual({
      groups: [],
      matchCount: 1,
      exists: true,
      truncated: false,
    });
  });

  test("countOnly returns the match count without groups", async () => {
    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        countOnly: true,
      },
    }).run();

    expect(result).toEqual({
      groups: [],
      matchCount: 2,
      exists: true,
      truncated: false,
    });
  });

  test("maxOutputLines truncates emitted lines including context", async () => {
    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        afterContext: 1,
        maxOutputLines: 2,
      },
    }).run();

    expect(result.truncated).toBe(true);
    expect(result.groups).toEqual([
      {
        startLine: 2,
        endLine: 3,
        lines: [
          { line: 2, text: "bravo foo", match: true },
          { line: 3, text: "charlie", match: false },
        ],
      },
    ]);
  });

  test("maxOutputChars truncates when the next line would exceed the budget", async () => {
    mockText("ab\ncd\nef\n");

    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: ".",
        maxOutputChars: 6,
      },
    }).run();

    expect(result.truncated).toBe(true);
    expect(result.groups[0].lines.map((l) => l.text)).toEqual(["ab", "cd"]);
  });

  test("rejects maxMatches of zero", async () => {
    await expect(
      new FileGrepTask({
        defaults: {
          url: "https://example.com/log.txt",
          pattern: "foo",
          maxMatches: 0,
        },
      }).run()
    ).rejects.toThrow(/maxMatches/);
  });

  test("rejects a negative context window", async () => {
    await expect(
      new FileGrepTask({
        defaults: {
          url: "https://example.com/log.txt",
          pattern: "foo",
          afterContext: -1,
        },
      }).run()
    ).rejects.toThrow(/afterContext/);
  });

  test("onlyMatching emits the matched substring instead of the line", async () => {
    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        onlyMatching: true,
      },
    }).run();

    expect(result.matchCount).toBe(2);
    expect(result.groups).toEqual([
      {
        startLine: 2,
        endLine: 2,
        lines: [{ line: 2, text: "foo", match: true }],
      },
      {
        startLine: 5,
        endLine: 5,
        lines: [{ line: 5, text: "foo", match: true }],
      },
    ]);
  });

  test("onlyMatching emits one entry per match on a line", async () => {
    mockText("foo bar foo\n");

    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        onlyMatching: true,
      },
    }).run();

    // matchCount counts matching LINES, as `grep -c` does even with -o.
    expect(result.matchCount).toBe(1);
    expect(result.groups).toEqual([
      {
        startLine: 1,
        endLine: 1,
        lines: [
          { line: 1, text: "foo", match: true },
          { line: 1, text: "foo", match: true },
        ],
      },
    ]);
  });

  test("onlyMatching emits the matched text, not the pattern", async () => {
    mockText("id=alpha\nid=bravo\n");

    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "id=\\w+",
        onlyMatching: true,
      },
    }).run();

    expect(result.groups[0].lines.map((l) => l.text)).toEqual(["id=alpha", "id=bravo"]);
  });

  test("onlyMatching with ignoreCase keeps the original casing", async () => {
    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        ignoreCase: true,
        onlyMatching: true,
      },
    }).run();

    expect(result.groups.flatMap((g) => g.lines.map((l) => l.text))).toEqual(["foo", "FOO", "foo"]);
  });

  test("onlyMatching with fixedString emits the literal occurrences", async () => {
    mockText("cost is $5.00 and $5X00\n");

    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "$5.00",
        fixedString: true,
        onlyMatching: true,
      },
    }).run();

    expect(result.groups[0].lines.map((l) => l.text)).toEqual(["$5.00"]);
  });

  test("onlyMatching suppresses context lines", async () => {
    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "charlie",
        context: 1,
        onlyMatching: true,
      },
    }).run();

    expect(result.groups).toEqual([
      {
        startLine: 3,
        endLine: 3,
        lines: [{ line: 3, text: "charlie", match: true }],
      },
    ]);
  });

  test("onlyMatching with invertMatch emits nothing", async () => {
    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        invertMatch: true,
        onlyMatching: true,
      },
    }).run();

    expect(result.exists).toBe(true);
    expect(result.matchCount).toBe(4);
    expect(result.groups).toEqual([]);
  });

  test("onlyMatching skips zero-length matches", async () => {
    mockText("abc\n");

    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "x*",
        onlyMatching: true,
      },
    }).run();

    expect(result.exists).toBe(true);
    expect(result.groups).toEqual([]);
  });

  test("onlyMatching still counts lines under countOnly", async () => {
    mockText("foo bar foo\nfoo again\n");

    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        onlyMatching: true,
        countOnly: true,
      },
    }).run();

    expect(result).toEqual({
      groups: [],
      matchCount: 2,
      exists: true,
      truncated: false,
    });
  });

  test("onlyMatching keeps every match of the line maxMatches stops on", async () => {
    mockText("foo bar foo\nfoo again\n");

    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        onlyMatching: true,
        maxMatches: 1,
      },
    }).run();

    expect(result.matchCount).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.groups[0].lines.map((l) => l.text)).toEqual(["foo", "foo"]);
  });

  test("onlyMatching truncates on maxOutputLines mid-line", async () => {
    mockText("foo foo foo\n");

    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        onlyMatching: true,
        maxOutputLines: 2,
      },
    }).run();

    expect(result.truncated).toBe(true);
    expect(result.groups[0].lines).toHaveLength(2);
  });

  test("splits CRLF the same as LF", async () => {
    mockText("one\r\ntwo foo\r\nthree\r\n");

    const result = await new FileGrepTask({
      defaults: { url: "https://example.com/log.txt", pattern: "foo" },
    }).run();

    expect(result.groups).toEqual([
      {
        startLine: 2,
        endLine: 2,
        lines: [{ line: 2, text: "two foo", match: true }],
      },
    ]);
  });

  test("empty file has no matches", async () => {
    mockText("");

    const result = await new FileGrepTask({
      defaults: { url: "https://example.com/log.txt", pattern: "foo" },
    }).run();

    expect(result).toEqual({
      groups: [],
      matchCount: 0,
      exists: false,
      truncated: false,
    });
  });
});
