/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the built client lives, which differs by how the CLI was started:
 * bundled (`dist/workglow.js`) it sits beside this module, and from source
 * (`src/web/staticFiles.ts`) it is two levels up in `dist/web`. Resolved by
 * probing rather than by a mode flag, so `bun src/workglow.ts web` and the
 * published binary both serve the same files.
 */
const ASSET_ROOT_CANDIDATES = ["./web/", "../../dist/web/"] as const;

let cachedRoot: string | undefined;

export function webAssetRoot(): string {
  if (cachedRoot) return cachedRoot;
  for (const candidate of ASSET_ROOT_CANDIDATES) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(path)) {
      cachedRoot = path;
      return path;
    }
  }
  // Nothing built yet: return the bundled location so the handler's "not built"
  // message is what a caller sees, rather than a path that happens to exist.
  return fileURLToPath(new URL(ASSET_ROOT_CANDIDATES[0], import.meta.url));
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
