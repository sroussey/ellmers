/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// First char must not be "." (rejects "." / ".." traversal); otherwise the
// hub's id alphabet — letters, digits, "_", "-", "." — including ids that
// start with "_" or "-" (both exist on the hub).
const ID_SEGMENT = /^[\w-][\w.-]*$/;

/**
 * Validate and re-encode a HuggingFace repo id (`name` or `org/name`) for use
 * in a hub URL. Ids come from CLI flags, so each segment is checked against
 * the hub's id alphabet, dot-only segments are rejected, and the returned
 * value is rebuilt from URL-encoded segments — user input can neither change
 * the request host nor traverse to a different API path.
 */
export function sanitizeHubRepoId(id: string): string {
  const segments = id.split("/");
  if (segments.length < 1 || segments.length > 2) {
    throw new Error(`invalid HuggingFace repo id "${id}" — expected "name" or "org/name"`);
  }
  return segments.map((segment) => encodeIdSegment(segment, id)).join("/");
}

/**
 * Validate and re-encode a file path inside a hub repo (e.g. from the repo's
 * tree listing) for use in a `resolve/` download URL. Rejects empty, `.`, and
 * `..` segments and URL-encodes the rest.
 */
export function sanitizeHubFilePath(path: string): string {
  const segments = path.split("/");
  if (segments.length === 0) throw new Error(`invalid hub file path "${path}"`);
  return segments
    .map((segment) => {
      if (segment === "" || segment === "." || segment === "..") {
        throw new Error(`invalid hub file path segment in "${path}"`);
      }
      return encodeURIComponent(segment);
    })
    .join("/");
}

function encodeIdSegment(segment: string, id: string): string {
  if (!ID_SEGMENT.test(segment)) {
    throw new Error(
      `invalid HuggingFace repo id "${id}" — segments may contain letters, digits, ` +
        `".", "_", "-" and must not start with "."`
    );
  }
  return encodeURIComponent(segment);
}
