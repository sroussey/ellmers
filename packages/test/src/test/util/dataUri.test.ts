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
