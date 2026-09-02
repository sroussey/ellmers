/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command, Option } from "commander";
import type { WebCommandBadge } from "./annotations";

export interface WebCommandOption {
  /** Long flag without dashes, which is also how an invocation names it. */
  readonly name: string;
  readonly flags: string;
  readonly description: string;
  readonly kind: "boolean" | "value";
  readonly required: boolean;
  readonly defaultValue: string | boolean | undefined;
  readonly choices: readonly string[] | undefined;
}

export interface WebCommandArgument {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly choices: readonly string[] | undefined;
}

export interface WebCommandNode {
  readonly path: readonly string[];
  readonly name: string;
  readonly description: string;
  readonly children: readonly WebCommandNode[];
  readonly args: readonly WebCommandArgument[];
  readonly options: readonly WebCommandOption[];
  /**
   * Set by `annotateCommandTree` where the tree is served, never read off the
   * commander program: commander knows a command's flags, not what running it
   * costs or destroys.
   */
  readonly badges?: readonly WebCommandBadge[];
  readonly note?: string;
  readonly confirm?: string;
}

/** Flags that exist to print text, which is not a thing this surface can run. */
const OMITTED_OPTIONS: ReadonlySet<string> = new Set(["help", "version"]);

function optionKind(option: Option): "boolean" | "value" {
  return option.required || option.optional ? "value" : "boolean";
}

function optionName(option: Option): string | undefined {
  const long = option.long;
  if (!long) return undefined;
  return long.replace(/^--(no-)?/, "");
}

function readOptions(command: Command): WebCommandOption[] {
  const out: WebCommandOption[] = [];
  for (const option of command.options) {
    if (option.hidden) continue;
    const name = optionName(option);
    if (!name || OMITTED_OPTIONS.has(name)) continue;
    out.push({
      name,
      flags: option.flags,
      description: option.description,
      kind: optionKind(option),
      required: option.mandatory,
      defaultValue: option.defaultValue as string | boolean | undefined,
      choices: option.argChoices,
    });
  }
  return out;
}

function readArguments(command: Command): WebCommandArgument[] {
  return command.registeredArguments.map((argument) => ({
    name: argument.name(),
    description: argument.description,
    required: argument.required,
    variadic: argument.variadic,
    choices: argument.argChoices,
  }));
}

function isRunnable(command: Command): boolean {
  const name = command.name();
  // `web` is this surface: listing it would offer a button that starts another
  // console from inside the one already running.
  if (name === "help" || name === "web") return false;
  return !(command as unknown as { _hidden?: boolean })._hidden;
}

function readCommand(command: Command, parentPath: readonly string[]): WebCommandNode {
  const path = [...parentPath, command.name()];
  return {
    path,
    name: command.name(),
    description: command.description(),
    children: command.commands.filter(isRunnable).map((child) => readCommand(child, path)),
    args: readArguments(command),
    options: readOptions(command),
  };
}

/**
 * The runnable command surface, read off the live program rather than restated.
 *
 * A downstream CLI (sec, embarc-data) registers its commands on the same
 * program object, so its tree — to whatever depth it nests — appears here with
 * nothing to keep in sync.
 */
export function buildCommandTree(program: Command): readonly WebCommandNode[] {
  return program.commands.filter(isRunnable).map((command) => readCommand(command, []));
}

/** Finds a node by its exact path, or undefined when the path names nothing. */
export function findCommandNode(
  nodes: readonly WebCommandNode[],
  path: readonly string[]
): WebCommandNode | undefined {
  if (path.length === 0) return undefined;
  const node = nodes.find((candidate) => candidate.name === path[0]);
  if (!node) return undefined;
  return path.length === 1 ? node : findCommandNode(node.children, path.slice(1));
}
