/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Built client assets live beside the built server code, in `dist/web`. */
export function webAssetRoot(): string {
  return fileURLToPath(new URL("./web/", import.meta.url));
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path)] ?? "application/octet-stream";
}

/**
 * Maps a URL path to a file inside the asset root, or undefined when it does
 * not name one. Anything that resolves outside the root is refused: a served
 * directory plus a caller-supplied path is the classic way to hand out
 * `/etc/passwd`.
 */
export function resolveWebAsset(urlPath: string, root = webAssetRoot()): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  const relative = decoded === "/" || decoded === "" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = resolve(root, relative);
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!candidate.startsWith(rootWithSep)) return undefined;
  return candidate;
}

export function webAssetExists(path: string): boolean {
  return existsSync(path);
}
