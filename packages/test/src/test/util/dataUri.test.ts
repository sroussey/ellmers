/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { dataUriToBlob } from "@workglow/util/media";
import { describe, expect, test } from "vitest";

// 1x1 transparent PNG.
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("dataUriToBlob", () => {
  test("decodes a base64 data URI to bytes with the declared mime type", async () => {
    const blob = dataUriToBlob(PNG_1X1);
    expect(blob).toBeDefined();
    expect(blob!.type).toBe("image/png");

    const bytes = new Uint8Array(await blob!.arrayBuffer());
    // PNG magic number.
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  test("decodes a percent-encoded (non-base64) data URI", async () => {
    const blob = dataUriToBlob("data:text/plain,hello%20world");
    expect(blob!.type).toBe("text/plain");
    expect(await blob!.text()).toBe("hello world");
  });

  // A non-base64 payload is percent-encoded *bytes*, not text, so it must not be
  // UTF-8 validated on the way through — 0x89 opens every PNG and is not legal
  // UTF-8 on its own. `fetch()` decodes this URI; so must we.
  test("decodes a percent-encoded binary (non-UTF-8) payload", async () => {
    const blob = dataUriToBlob("data:image/png,%89PNG%0D%0A%1A%0A%FF%FE");
    expect(blob).toBeDefined();
    expect(blob!.type).toBe("image/png");

    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71, 13, 10, 26, 10, 255, 254]);
  });

  test("decodes percent-encoded multi-byte UTF-8 and literal non-ASCII alike", async () => {
    expect(await dataUriToBlob("data:text/plain,%E2%9C%93%20caf%C3%A9")!.text()).toBe("✓ café");
    // Unescaped characters are UTF-8 encoded, per the data-URL processor.
    expect(await dataUriToBlob("data:text/plain,café")!.text()).toBe("café");
  });

  // WHATWG percent-decode (and therefore `fetch()`) emits a `%` that is not
  // followed by two hex digits literally rather than failing.
  test("passes through a lone percent sign instead of failing", async () => {
    expect(await dataUriToBlob("data:text/plain,100%")!.text()).toBe("100%");
    expect(await dataUriToBlob("data:text/plain,50%zz off")!.text()).toBe("50%zz off");
  });

  test("defaults the mime type when the header omits one", async () => {
    const blob = dataUriToBlob("data:,plain");
    expect(blob!.type).toBe("text/plain");
    expect(await blob!.text()).toBe("plain");
  });

  test("ignores parameters after the mime type", () => {
    expect(dataUriToBlob("data:text/plain;charset=utf-8,hi")!.type).toBe("text/plain");
  });

  test("returns undefined for non-data URIs", () => {
    expect(dataUriToBlob("https://example.com/a.png")).toBeUndefined();
    expect(dataUriToBlob("blob:http://localhost/abc")).toBeUndefined();
  });

  test("returns undefined for a malformed URI", () => {
    expect(dataUriToBlob("data:image/png;base64")).toBeUndefined();
    expect(dataUriToBlob("data:image/png;base64,!!!not base64!!!")).toBeUndefined();
  });
});
