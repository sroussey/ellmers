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

/**
 * The inverse of {@link toInvocation}: an invocation read back into the form.
 *
 * Arguments are positional, so they fill the argument fields in declared
 * order; options and config land by key. Whatever the invocation does not
 * mention keeps the field's own default, so a partially specified invocation
 * fills what it knows and leaves the rest as the form would have opened.
 */
export function valuesFromInvocation(
  fields: readonly WebField[],
  invocation: WebInvocation
): FormValues {
  const values = initialValues(fields);
  fields
    .filter((field) => field.source === "argument")
    .forEach((field, index) => {
      const value = invocation.args[index];
      if (value !== undefined) values[field.key] = value;
    });
  for (const [key, value] of Object.entries(invocation.options)) values[key] = value;
  for (const [key, value] of Object.entries(invocation.config ?? {})) values[key] = value;
  return values;
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

/** What the widget needs to answer a scoped question, and nothing more. */
export interface WidgetScope {
  readonly path: readonly string[];
  readonly args: readonly string[];
  readonly values: FormValues;
}

/**
 * A scope's content as a string, for use as an effect dependency.
 *
 * Deliberately covers exactly what a widget search sends — the path, the
 * positional arguments and the field values — so two scopes that would produce
 * the same request compare equal however many times the form has re-rendered.
 */
export function stableScopeKey(scope: WidgetScope): string {
  const values = Object.keys(scope.values)
    .sort()
    // The pair separator is a control character too, not `=`: a key containing
    // `=` would otherwise serialize identically to a shorter key whose value
    // starts with the rest of it, and the whole point of this string is that
    // two scopes compare equal exactly when they would send the same request.
    .map((key) => `${key}\u0002${String(scope.values[key] ?? "")}`);
  return [scope.path.join("."), scope.args.join("\u0000"), values.join("\u0000")].join("\u0001");
}

/**
 * Appends to a comma-separated field rather than replacing it.
 *
 * `--models` and `--extractors` take lists, and picking a second model from a
 * picker that replaces is picking nothing: you get the last one you clicked.
 */
export function appendValue(current: string, picked: string): string {
  const parts = current
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.includes(picked)) return parts.join(",");
  return [...parts, picked].join(",");
}
