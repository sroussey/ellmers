/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskGraph } from "@workglow/task-graph";
import { computeGraphInputSchema } from "@workglow/task-graph";
import type { DataPortSchemaNonBoolean, DataPortSchemaObject } from "@workglow/util/schema";
import { resolveTaskType } from "../taskTypes";
import type { WebCommandNode } from "./commandTree";

export interface WebField {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly type: "string" | "number" | "integer" | "boolean" | "enum" | "array" | "object";
  /** The widget hook: a schema `format` like "model" or "sec:cik". */
  readonly format: string | undefined;
  readonly required: boolean;
  readonly advanced: boolean;
  readonly defaultValue: unknown;
  readonly choices: readonly string[] | undefined;
  readonly source: "argument" | "schema" | "config" | "option";
}

/**
 * Answers "what does this command take, given the arguments chosen so far".
 *
 * `task run` cannot say until it knows the task type, and `workflow run`
 * cannot say until it knows the workflow — which is why the arguments are an
 * input here rather than the fields being static per command.
 */
export interface CommandSchemas {
  readonly input: DataPortSchemaObject | undefined;
  /** Task config, which the CLI takes on single-dash flags. */
  readonly config: DataPortSchemaObject | undefined;
}

export interface CommandSchemaProvider {
  readonly path: readonly string[];
  resolve(args: readonly string[]): Promise<CommandSchemas | undefined>;
}

/** Flags the terminal keeps behind `--help`; the page keeps them behind a fold. */
const ADVANCED_OPTIONS: ReadonlySet<string> = new Set([
  "dry-run",
  "input-json",
  "input-json-file",
  "config-json",
  "config-json-file",
  "output-json-file",
  "interactive",
  "format",
  "limit",
]);

const providers: CommandSchemaProvider[] = [];

export function registerCommandSchemaProvider(provider: CommandSchemaProvider): void {
  const at = providers.findIndex((p) => samePath(p.path, provider.path));
  if (at >= 0) providers[at] = provider;
  else providers.push(provider);
}

export function resetCommandSchemaProvidersForTesting(): void {
  providers.length = 0;
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index]);
}

function fieldType(property: DataPortSchemaNonBoolean): WebField["type"] {
  if ("enum" in property && Array.isArray(property.enum)) return "enum";
  switch (property.type as string | undefined) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "integer":
      return "integer";
    case "array":
      return "array";
    case "object":
      return "object";
    default:
      return "string";
  }
}

function humanize(key: string): string {
  return key.replace(/[_-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function schemaFields(schema: DataPortSchemaObject): Omit<WebField, "source">[] {
  const required = new Set((schema.required as readonly string[] | undefined) ?? []);
  const fields: Omit<WebField, "source">[] = [];
  for (const [key, raw] of Object.entries(schema.properties ?? {})) {
    if (typeof raw === "boolean" || !raw) continue;
    const property = raw as DataPortSchemaNonBoolean;
    const record = property as Record<string, unknown>;
    if (record["x-ui-hidden"] || "const" in property) continue;
    const isRequired = required.has(key);
    fields.push({
      key,
      label: (property.title as string | undefined) ?? humanize(key),
      description: (property.description as string | undefined) ?? "",
      type: fieldType(property),
      format: property.format as string | undefined,
      required: isRequired,
      // The terminal prompts for exactly the required-and-defaultless fields;
      // everything else is something you may set, not something you must.
      advanced: !isRequired && "default" in property,
      defaultValue: (property as { default?: unknown }).default,
      choices:
        "enum" in property && Array.isArray(property.enum)
          ? (property.enum as readonly string[])
          : undefined,
    });
  }
  return fields;
}

/**
 * The form for one command: its positional arguments, then whatever its input
 * schema declares, then its flags.
 *
 * A command with no schema provider degrades to arguments and flags, which is
 * every command a downstream CLI adds without doing anything.
 */
export async function resolveCommandFields(
  node: WebCommandNode,
  args: readonly string[]
): Promise<readonly WebField[]> {
  const fields: WebField[] = node.args.map((argument) => ({
    key: argument.name,
    label: humanize(argument.name),
    description: argument.description,
    type: argument.choices ? "enum" : "string",
    format: undefined,
    required: argument.required,
    advanced: false,
    defaultValue: undefined,
    choices: argument.choices,
    source: "argument",
  }));

  const provider = providers.find((candidate) => samePath(candidate.path, node.path));
  if (provider) {
    let schemas: CommandSchemas | undefined;
    try {
      schemas = await provider.resolve(args);
    } catch {
      schemas = undefined;
    }
    if (schemas?.input) {
      for (const field of schemaFields(schemas.input)) fields.push({ ...field, source: "schema" });
    }
    if (schemas?.config) {
      const inputKeys = new Set(Object.keys(schemas.input?.properties ?? {}));
      for (const field of schemaFields(schemas.config)) {
        // A config key that also names an input port has no shorthand form in
        // the CLI, so offering it here would compose a flag the CLI reads as
        // the input one.
        if (inputKeys.has(field.key)) continue;
        fields.push({ ...field, source: "config", advanced: true });
      }
    }
  }

  for (const option of node.options) {
    fields.push({
      key: option.name,
      label: option.name,
      description: option.description,
      type: option.kind === "boolean" ? "boolean" : option.choices ? "enum" : "string",
      format: undefined,
      required: option.required,
      advanced: ADVANCED_OPTIONS.has(option.name),
      defaultValue: option.defaultValue,
      choices: option.choices,
      source: "option",
    });
  }
  return fields;
}

function asObjectSchema(schema: unknown): DataPortSchemaObject | undefined {
  return typeof schema === "object" && schema !== null
    ? (schema as DataPortSchemaObject)
    : undefined;
}

export type WorkflowGraphLoader = (id: string) => Promise<TaskGraph | undefined>;

/** The two commands whose real input lives in a schema rather than in flags. */
export function registerBuiltInSchemaProviders(loadWorkflowGraph: WorkflowGraphLoader): void {
  registerCommandSchemaProvider({
    path: ["task", "run"],
    resolve: async (args) => {
      const ctor = args[0] ? resolveTaskType(args[0]) : undefined;
      if (!ctor) return undefined;
      return {
        input: asObjectSchema(ctor.inputSchema()),
        config: asObjectSchema(ctor.configSchema?.()),
      };
    },
  });
  registerCommandSchemaProvider({
    path: ["workflow", "run"],
    resolve: async (args) => {
      const graph = args[0] ? await loadWorkflowGraph(args[0]) : undefined;
      if (!graph) return undefined;
      return { input: asObjectSchema(computeGraphInputSchema(graph)), config: undefined };
    },
  });
}
