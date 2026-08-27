/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import type { ITransformDef } from "../TransformTypes";

const stringSchema: DataPortSchema = { type: "string" } as DataPortSchema;
const booleanSchema: DataPortSchema = { type: "boolean" } as DataPortSchema;

export const numberToStringTransform: ITransformDef = {
  id: "numberToString",
  title: "Number → String",
  category: "Conversion",
  paramsSchema: undefined,
  inferOutputSchema: () => stringSchema,
  apply: (v) => String(v),
  suggestFromSchemas(source, target) {
    const s = source as any;
    const t = target as any;
    if ((s?.type === "number" || s?.type === "integer") && t?.type === "string") {
      return { score: 0.8, params: {} };
    }
    return undefined;
  },
};

export const toBooleanTransform: ITransformDef = {
  id: "toBoolean",
  title: "To Boolean",
  category: "Conversion",
  paramsSchema: undefined,
  inferOutputSchema: () => booleanSchema,
  apply: (v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
    return Boolean(v);
  },
};

export const stringifyTransform: ITransformDef = {
  id: "stringify",
  title: "JSON.stringify",
  category: "Conversion",
  paramsSchema: undefined,
  inferOutputSchema: () => stringSchema,
  apply: (v) => JSON.stringify(v),
  suggestFromSchemas(_source, target) {
    const t = target as any;
    return t?.type === "string" ? { score: 0.4, params: {} } : undefined;
  },
};

export const parseJsonTransform: ITransformDef = {
  id: "parseJson",
  title: "Parse JSON",
  category: "Conversion",
  paramsSchema: undefined,
  inferOutputSchema: () => ({}) as DataPortSchema,
  apply: (v) => JSON.parse(String(v)),
};
