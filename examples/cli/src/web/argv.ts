/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebCommandNode } from "./commandTree";

/**
 * What the page describes and the server runs. Kept free of `node:` imports:
 * the browser composes the same value and renders the same line from it, so
 * what you read on screen is what executes.
 */
export interface WebInvocation {
  readonly path: readonly string[];
  readonly args: readonly string[];
  readonly options: Readonly<Record<string, string | boolean>>;
}

/** Characters that would change meaning if the line were pasted into a shell. */
const NEEDS_QUOTING = /[\s"'$`\\|&;<>()*?!#~[\]{}]/;

export function composeArgv(invocation: WebInvocation): string[] {
  const argv: string[] = [...invocation.path, ...invocation.args];
  for (const [name, value] of Object.entries(invocation.options)) {
    if (value === false || value === undefined) continue;
    argv.push(`--${name}`);
    if (value !== true) argv.push(String(value));
  }
  return argv;
}

function quote(value: string): string {
  if (value === "") return '""';
  return NEEDS_QUOTING.test(value) ? `"${value.replace(/(["\\$`])/g, "\\$1")}"` : value;
}

/** The invocation as you would have typed it. */
export function renderCliLine(binary: string, invocation: WebInvocation): string {
  const parts = [binary, ...invocation.path, ...invocation.args.map(quote)];
  for (const [name, value] of Object.entries(invocation.options)) {
    if (value === false || value === undefined) continue;
    parts.push(`--${name}`);
    if (value !== true) parts.push(quote(String(value)));
  }
  return parts.join(" ");
}

/**
 * The only gate between a page and `spawn`.
 *
 * An option the command does not declare is rejected rather than passed
 * through: this is the boundary where a browser's JSON becomes a process
 * argument, and commander would happily take an unknown flag on a command that
 * allows them.
 */
export function validateInvocation(node: WebCommandNode, invocation: WebInvocation): string[] {
  const errors: string[] = [];

  node.args.forEach((argument, index) => {
    const value = invocation.args[index];
    if (argument.required && (value === undefined || value === "")) {
      errors.push(`${argument.name} is required`);
      return;
    }
    if (value !== undefined && argument.choices && !argument.choices.includes(value)) {
      errors.push(`${argument.name} must be one of ${argument.choices.join(", ")}`);
    }
  });
  if (invocation.args.length > node.args.length && !node.args.some((a) => a.variadic)) {
    errors.push(`${node.name} takes ${node.args.length} argument(s)`);
  }

  const declared = new Map(node.options.map((option) => [option.name, option]));
  for (const [name, value] of Object.entries(invocation.options)) {
    const option = declared.get(name);
    if (!option) {
      errors.push(`unknown option "${name}"`);
      continue;
    }
    if (option.kind === "boolean" && typeof value !== "boolean") {
      errors.push(`${name} is a flag and takes no value`);
      continue;
    }
    if (option.kind === "value" && typeof value === "boolean") {
      errors.push(`${name} needs a value`);
      continue;
    }
    if (option.choices && typeof value === "string" && !option.choices.includes(value)) {
      errors.push(`${name} must be one of ${option.choices.join(", ")}`);
    }
  }
  for (const option of node.options) {
    if (option.required && invocation.options[option.name] === undefined) {
      errors.push(`${option.name} is required`);
    }
  }
  return errors;
}
