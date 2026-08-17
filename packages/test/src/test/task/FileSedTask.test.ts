/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileSedTask, registerSafeFetch, type SafeFetchFn } from "@workglow/tasks";
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

describe("FileSedTask", () => {
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

  test("has Document category and FileSedTask type", () => {
    expect(FileSedTask.type).toBe("FileSedTask");
    expect(FileSedTask.category).toBe("Document");
  });

  test("substitutes the first occurrence on each matching line", async () => {
    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        replacement: "bar",
      },
    }).run();

    expect(result.replacementCount).toBe(2);
    expect(result.linesChanged).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("alpha\nbravo bar\ncharlie\nFOO delta\necho bar bar\nfoxtrot\n");
  });

  test("leaves the document untouched when nothing matches", async () => {
    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "zzz",
        replacement: "bar",
      },
    }).run();

    expect(result.replacementCount).toBe(0);
    expect(result.linesChanged).toBe(0);
    expect(result.text).toBe(`${SAMPLE}\n`);
  });

  test("global replaces every occurrence on a line", async () => {
    mockText("foo foo foo\n");

    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        replacement: "bar",
        global: true,
      },
    }).run();

    expect(result.replacementCount).toBe(3);
    expect(result.linesChanged).toBe(1);
    expect(result.text).toBe("bar bar bar\n");
  });

  test("without global only the first occurrence on a line changes", async () => {
    mockText("foo foo foo\n");

    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        replacement: "bar",
      },
    }).run();

    expect(result.replacementCount).toBe(1);
    expect(result.text).toBe("bar foo foo\n");
  });

  test("ignoreCase substitutes regardless of case", async () => {
    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        replacement: "bar",
        ignoreCase: true,
      },
    }).run();

    expect(result.replacementCount).toBe(3);
    expect(result.text).toContain("bar delta");
  });

  test("expands $1 capture groups", async () => {
    mockText("2026-08-17\n");

    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "(\\d{4})-(\\d{2})-(\\d{2})",
        replacement: "$3/$2/$1",
      },
    }).run();

    expect(result.text).toBe("17/08/2026\n");
  });

  test("expands $& and $$", async () => {
    mockText("price 42\n");

    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "\\d+",
        replacement: "$$$&",
      },
    }).run();

    expect(result.text).toBe("price $42\n");
  });

  test("expands named groups", async () => {
    mockText("name: ada\n");

    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "name: (?<who>\\w+)",
        replacement: "hello $<who>",
      },
    }).run();

    expect(result.text).toBe("hello ada\n");
  });

  test("leaves an unterminated $< and an out-of-range $n literal", async () => {
    mockText("x\n");

    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "(x)",
        replacement: "$<who $2 $1",
      },
    }).run();

    expect(result.text).toBe("$<who $2 x\n");
  });

  test("prefers a two-digit group reference when that group exists", async () => {
    mockText("abcdefghijk\n");

    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)",
        replacement: "$11-$1-$12",
      },
    }).run();

    expect(result.text).toBe("k-a-a2\n");
  });

  test("fixedString treats pattern and replacement as literals", async () => {
    mockText("cost is $5.00\ncost is $50\n");

    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "$5.00",
        replacement: "$1 free",
        fixedString: true,
      },
    }).run();

    expect(result.replacementCount).toBe(1);
    expect(result.text).toBe("cost is $1 free\ncost is $50\n");
  });

  test("maxReplacements stops substituting and passes the rest through", async () => {
    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        replacement: "bar",
        maxReplacements: 1,
      },
    }).run();

    expect(result.replacementCount).toBe(1);
    expect(result.linesChanged).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("alpha\nbravo bar\ncharlie\nFOO delta\necho foo bar\nfoxtrot\n");
  });

  test("maxReplacements bounds a global substitution mid-line", async () => {
    mockText("foo foo foo\n");

    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        replacement: "bar",
        global: true,
        maxReplacements: 2,
      },
    }).run();

    expect(result.replacementCount).toBe(2);
    expect(result.text).toBe("bar bar foo\n");
  });

  test("onlyChangedLines emits just the substituted lines", async () => {
    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        replacement: "bar",
        onlyChangedLines: true,
      },
    }).run();

    expect(result.linesChanged).toBe(2);
    expect(result.text).toBe("bravo bar\necho bar bar\n");
  });

  test("maxOutputLines truncates the emitted document", async () => {
    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        replacement: "bar",
        maxOutputLines: 2,
      },
    }).run();

    expect(result.truncated).toBe(true);
    expect(result.text).toBe("alpha\nbravo bar\n");
  });

  test("maxOutputChars truncates when the next line would exceed the budget", async () => {
    mockText("ab\ncd\nef\n");

    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "z",
        replacement: "y",
        maxOutputChars: 6,
      },
    }).run();

    expect(result.truncated).toBe(true);
    expect(result.text).toBe("ab\ncd\n");
  });

  test("rejects maxReplacements of zero", async () => {
    await expect(
      new FileSedTask({
        defaults: {
          url: "https://example.com/log.txt",
          pattern: "foo",
          replacement: "bar",
          maxReplacements: 0,
        },
      }).run()
    ).rejects.toThrow(/maxReplacements/);
  });

  test("rejects a negative output limit", async () => {
    await expect(
      new FileSedTask({
        defaults: {
          url: "https://example.com/log.txt",
          pattern: "foo",
          replacement: "bar",
          maxOutputLines: -1,
        },
      }).run()
    ).rejects.toThrow(/maxOutputLines/);
  });

  test("rejects an invalid regular expression", async () => {
    await expect(
      new FileSedTask({
        defaults: {
          url: "https://example.com/log.txt",
          pattern: "foo(",
          replacement: "bar",
        },
      }).run()
    ).rejects.toThrow(/Invalid regular expression/);
  });

  test("rejects a nested-quantifier pattern", async () => {
    await expect(
      new FileSedTask({
        defaults: {
          url: "https://example.com/log.txt",
          pattern: "(a+)+",
          replacement: "bar",
        },
      }).run()
    ).rejects.toThrow(/nested quantifiers/);
  });

  test("rejects an empty fixed string", async () => {
    await expect(
      new FileSedTask({
        defaults: {
          url: "https://example.com/log.txt",
          pattern: "",
          replacement: "bar",
          fixedString: true,
        },
      }).run()
    ).rejects.toThrow(/fixedString/);
  });

  test("splits CRLF the same as LF", async () => {
    mockText("one\r\ntwo foo\r\nthree\r\n");

    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        replacement: "bar",
      },
    }).run();

    expect(result.text).toBe("one\ntwo bar\nthree\n");
  });

  test("empty file yields empty output", async () => {
    mockText("");

    const result = await new FileSedTask({
      defaults: {
        url: "https://example.com/log.txt",
        pattern: "foo",
        replacement: "bar",
      },
    }).run();

    expect(result).toEqual({
      text: "",
      replacementCount: 0,
      linesChanged: 0,
      truncated: false,
    });
  });
});
