/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

export type EditInEditorResult =
  | { readonly status: "saved"; readonly content: string }
  | { readonly status: "unchanged" }
  | { readonly status: "editor_error"; readonly message: string };

/**
 * Shell command prefix for opening a file (same precedence as git: GIT_EDITOR, VISUAL, EDITOR).
 */
export function getEditorCommand(): string {
  const fallback = process.platform === "win32" ? "notepad" : "vi";
  return process.env.GIT_EDITOR ?? process.env.VISUAL ?? process.env.EDITOR ?? fallback;
}

/**
 * Writes `initialContent` to a temp file, launches the user's editor, then reads the file back.
 * Same idea as `git commit`: unchanged buffer ⇒ cancel; non-zero editor exit ⇒ error.
 */
export function editStringInExternalEditor(
  initialContent: string,
  tempBasename: string
): EditInEditorResult {
  const dir = mkdtempSync(join(tmpdir(), "workglow-edit-"));
  const file = join(dir, tempBasename);
  writeFileSync(file, initialContent, "utf-8");

  const shell = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "/bin/sh";
  try {
    const cmd = `${getEditorCommand()} ${JSON.stringify(file)}`;
    execSync(cmd, { stdio: "inherit", shell });
  } catch (e) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return { status: "editor_error", message: e instanceof Error ? e.message : String(e) };
  }

  let after: string;
  try {
    after = readFileSync(file, "utf-8");
  } catch (e) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return { status: "editor_error", message: e instanceof Error ? e.message : String(e) };
  }

  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  if (after === initialContent) {
    return { status: "unchanged" };
  }

  return { status: "saved", content: after };
}
