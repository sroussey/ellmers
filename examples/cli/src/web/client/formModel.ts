/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebInvocation } from "../argv";
import type { WebField } from "../commandFields";

export type FormValues = Record<string, string | boolean>;

export function initialValues(fields: readonly WebField[]): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    if (field.type === "boolean") {
      values[field.key] = field.defaultValue === true;
      continue;
    }
    if (field.defaultValue !== undefined && field.defaultValue !== null) {
      values[field.key] =
        typeof field.defaultValue === "string"
          ? field.defaultValue
          : JSON.stringify(field.defaultValue);
    }
  }
  return values;
}

function isDefault(field: WebField, value: string | boolean): boolean {
  if (field.defaultValue === undefined || field.defaultValue === null) return false;
  const asText =
    typeof field.defaultValue === "string"
      ? field.defaultValue
      : JSON.stringify(field.defaultValue);
  return String(value) === asText;
}

/**
 * Turns the form into the invocation the server runs.
 *
 * Arguments keep their declared order — they are positional — and a value
 * equal to its default is dropped, so the rendered command line says what you
 * changed rather than restating the command's own defaults back at you.
 */
export function toInvocation(
  fields: readonly WebField[],
  values: FormValues,
  path: readonly string[]
): WebInvocation {
  const args: string[] = [];
  const options: Record<string, string | boolean> = {};
  const config: Record<string, string | boolean> = {};

  for (const field of fields) {
    const value = values[field.key];
    if (field.source === "argument") {
      args.push(value === undefined ? "" : String(value));
      continue;
    }
    if (value === undefined || value === "" || value === false) continue;
    if (isDefault(field, value)) continue;
    if (field.source === "config") config[field.key] = value;
    else options[field.key] = value;
  }

  while (args.length > 0 && args[args.length - 1] === "") args.pop();
  return Object.keys(config).length > 0 ? { path, args, options, config } : { path, args, options };
}

export function formErrors(fields: readonly WebField[], values: FormValues): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    if (!field.required) continue;
    const value = values[field.key];
    if (value === undefined || value === "" || value === false) {
      errors.push(`${field.label} is required`);
    }
  }
  return errors;
}

/** The fields a form shows before the fold, and the ones it hides behind it. */
export function splitFields(fields: readonly WebField[]): {
  readonly args: readonly WebField[];
  readonly inputs: readonly WebField[];
  readonly advanced: readonly WebField[];
} {
  return {
    args: fields.filter((field) => field.source === "argument"),
    inputs: fields.filter((field) => field.source !== "argument" && !field.advanced),
    advanced: fields.filter((field) => field.source !== "argument" && field.advanced),
  };
}
