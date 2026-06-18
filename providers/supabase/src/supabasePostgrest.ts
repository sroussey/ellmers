/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** PostgREST / Postgres error indicating the referenced relation does not exist. */
export function isMissingRelationError(error: { code?: string; message?: string }): boolean {
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const msg = error.message ?? "";
  // Scope the message fallback to relation/table phrasing so unrelated
  // "X does not exist" errors (column, function, type, role) are not misread
  // as a missing table and don't spuriously trigger DDL bootstrap.
  if (msg.includes("could not find the table")) return true;
  return /\b(?:relation|table)\b.+does not exist/i.test(msg);
}

/** `exec_sql` RPC is not installed (production Supabase without admin RPC). */
export function isExecSqlUnavailable(error: { code?: string; message?: string }): boolean {
  const msg = error.message ?? "";
  // 42883 = "function ... does not exist". The code alone is ambiguous: a typo
  // or missing helper *inside* the DDL body would also produce 42883 and be
  // silently swallowed as "exec_sql missing", masking the real failure. Require
  // the message to actually name exec_sql.
  if (error.code === "42883" && msg.includes("exec_sql")) return true;
  return msg.includes("does not exist") && msg.includes("exec_sql");
}
