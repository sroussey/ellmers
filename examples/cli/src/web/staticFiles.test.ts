/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { contentTypeFor, resolveWebAsset } from "./staticFiles";

const ROOT = "/srv/app/dist/web/";

describe("resolveWebAsset", () => {
  it("maps / to the client entry document", () => {
    expect(resolveWebAsset("/", ROOT)).toBe("/srv/app/dist/web/index.html");
    expect(resolveWebAsset("/app.js", ROOT)).toBe("/srv/app/dist/web/app.js");
  });

  it("refuses to escape the asset directory", () => {
    expect(resolveWebAsset("/../../etc/passwd", ROOT)).toBeUndefined();
    expect(resolveWebAsset("/..%2f..%2fetc/passwd", ROOT)).toBeUndefined();
    expect(resolveWebAsset("/%2e%2e/%2e%2e/etc/passwd", ROOT)).toBeUndefined();
  });

  it("refuses a path it cannot even decode", () => {
    expect(resolveWebAsset("/%zz", ROOT)).toBeUndefined();
  });
});

describe("contentTypeFor", () => {
  it("names the types the client ships", () => {
    expect(contentTypeFor("/x/index.html")).toContain("text/html");
    expect(contentTypeFor("/x/app.js")).toContain("text/javascript");
    expect(contentTypeFor("/x/app.css")).toContain("text/css");
    expect(contentTypeFor("/x/thing.bin")).toBe("application/octet-stream");
  });
});
