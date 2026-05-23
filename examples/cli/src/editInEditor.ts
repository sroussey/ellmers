/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

export type EditInEditorResult =
  | { readonly status: "saved"; readonly content: string }
  | { readonly status: "unchanged" }
  | { readonly status: "editor_error"; readonly message: string };

export interface ParsedEditorCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

/**
 * Shell command prefix for opening a file (same precedence as git: GIT_EDITOR, VISUAL, EDITOR).
 */
export function getEditorCommand(): string {
  const fallback = process.platform === "win32" ? "notepad" : "vi";
  return process.env.GIT_EDITOR ?? process.env.VISUAL ?? process.env.EDITOR ?? fallback;
}

export function parseEditorCommand(command: string): ParsedEditorCommand {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  const trimmed = command.trim();

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    const next = trimmed[i + 1];

    if (
      char === "\\" &&
      next &&
      (/\s/.test(next) || next === "\\" || next === "'" || next === '"')
    ) {
      current += next;
      i++;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error("Editor command contains an unterminated quoted string");
  }

  if (current.length > 0) {
    parts.push(current);
  }

  const [executable, ...args] = parts;
  if (!executable) {
    throw new Error("Editor command is empty");
  }

  return { executable, args };
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

  try {
    const editor = parseEditorCommand(getEditorCommand());
    const result = spawnSync(editor.executable, [...editor.args, file], {
      stdio: "inherit",
      shell: false,
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        result.signal
          ? `Editor exited after signal ${result.signal}`
          : `Editor exited with status ${result.status ?? "unknown"}`
      );
    }
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
