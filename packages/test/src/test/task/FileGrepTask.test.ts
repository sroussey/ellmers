/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskAbortedError } from "@workglow/task-graph";
import { FileGrepTask, grepLines, registerSafeFetch, type SafeFetchFn } from "@workglow/tasks";
import { DEFAULT_LIMITS, setLogger } from "@workglow/util";
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

  /**
   * `truncated` is now computed rather than hard-coded: the match is on line 2
   * of 6, so four lines were never scanned and the scan really did stop early.
   * `matchCount` stays 1 — `existsOnly` stops at the first match, and 0 would
   * contradict `exists: true`.
   */
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
      truncated: true,
    });
  });

  test("existsOnly reports no truncation when the match is the last line", async () => {
    mockText("alpha\nbravo\ncharlie foo\n");

    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        existsOnly: true,
      },
    }).run();

    expect(result.truncated).toBe(false);
  });

  test("truncated is false when the last line is the final match", async () => {
    mockText("alpha\nfoo one\nbravo\nfoo two\n");

    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        maxMatches: 2,
      },
    }).run();

    expect(result.matchCount).toBe(2);
    expect(result.truncated).toBe(false);
  });

  test("maxMatches with afterContext still labels later matching lines as matches", async () => {
    mockText("foo a\nfoo b\nfoo c\ntail\n");

    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        maxMatches: 1,
        afterContext: 2,
      },
    }).run();

    expect(result.matchCount).toBe(1);
    const byLine = new Map(result.groups.flatMap((g) => g.lines).map((l) => [l.line, l.match]));
    expect(byLine.get(2)).toBe(true);
    expect(byLine.get(3)).toBe(true);
  });

  test("applies default output caps when the caller states none", async () => {
    mockText("foo\n".repeat(DEFAULT_LIMITS.grepMaxOutputLines + 500));

    const result = await new FileGrepTask({
      defaults: { url: "https://example.com/log.txt", pattern: "foo" },
    }).run();

    expect(result.truncated).toBe(true);
    expect(result.groups.flatMap((g) => g.lines)).toHaveLength(DEFAULT_LIMITS.grepMaxOutputLines);
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

  test("rejects a catastrophic pattern before reading the document", async () => {
    await expect(
      new FileGrepTask({
        defaults: { url: "https://example.com/log.txt", pattern: "(a+)+$" },
      }).run()
    ).rejects.toThrow(/nested quantifiers/);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  /**
   * `(\w|\d)*$` walks straight past the shape screen and is exponential all the
   * same: against `"1".repeat(n) + "!"` V8 takes 1 ms at n=16, 14 ms at n=20,
   * 218 ms at n=24 and 657 ms at n=26 — doubling per added character. At n=40
   * that is roughly 2^40 backtracking steps, on the order of days. Unbounded,
   * this run never returns and no abort can interrupt the one synchronous
   * `test()` it is stuck inside; the match budget is what turns it into a
   * rejection.
   *
   * The bypass is structural rather than an oversight: the two branches overlap
   * on the digits they both accept, and the screen compares branch TEXT, which
   * cannot see that. This is exactly why the screen is documented as a
   * heuristic and the budget as the enforced bound.
   */
  test("a guard-bypassing pattern fails on the match budget instead of hanging", async () => {
    mockText("1".repeat(40) + "!");

    const started = Date.now();
    await expect(
      new FileGrepTask({
        defaults: { url: "https://example.com/log.txt", pattern: "(\\w|\\d)*$" },
      }).run()
    ).rejects.toThrow(/budget/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  /**
   * Pre-fix the abort check ran between lines, which bought nothing: a single
   * `regex.test()` is uninterruptible, so a hostile line blocked forever with
   * the check sitting unreachable above it. It now runs between batches, and
   * how long one batch may run is what the matcher's budget bounds.
   *
   * Driven through `grepLines` rather than the task because an async generator
   * resolves on the MICROTASK queue: a purely in-memory source starves the
   * timer phase entirely, so a `setTimeout` abort would not fire until the scan
   * had already finished. The source below yields to the macrotask queue
   * periodically, which is what a real file stream does on every read.
   */
  test("aborts between batches", async () => {
    const controller = new AbortController();

    async function* source(): AsyncGenerator<string> {
      for (let i = 0; i < 200_000; i++) {
        if (i % 1_000 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        yield "foo";
      }
    }

    const started = Date.now();
    const running = grepLines(source(), "foo", { countOnly: true }, controller.signal);
    setTimeout(() => controller.abort(), 5);

    await expect(running).rejects.toThrow(TaskAbortedError);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  /**
   * The group de-duplication used to scan `currentGroup.lines` linearly on
   * every emit, so a run of contiguous matches was quadratic. Measured on the
   * pre-fix shape: 10 000 lines -> 126 ms, 20 000 -> 286 ms, 40 000 -> 1576 ms,
   * 80 000 -> 6390 ms — a clean 4x per doubling, which puts 200 000 at roughly
   * 40 s. The bound below is that curve's cost, not an arbitrary number.
   */
  test("greps 200k contiguous matching lines in bounded time", { timeout: 30_000 }, async () => {
    mockText("foo\n".repeat(200_000));

    const started = Date.now();
    const result = await new FileGrepTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        maxOutputLines: 200_000,
        maxOutputChars: 10_000_000,
      },
    }).run();

    expect(result.matchCount).toBe(200_000);
    expect(Date.now() - started).toBeLessThan(5_000);
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
