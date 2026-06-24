/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import type { ITransformDef } from "../TransformTypes";

interface UnixUnit {
  readonly unit: "s" | "ms";
}

const isoSchema: DataPortSchema = { type: "string", format: "date-time" } as DataPortSchema;
const numberSchema: DataPortSchema = { type: "number" } as DataPortSchema;

function hasDateTimeFormat(schema: DataPortSchema): boolean {
  const s = schema as any;
  return s?.type === "string" && s.format === "date-time";
}

export const unixToIsoDateTransform: ITransformDef<UnixUnit> = {
  id: "unixToIsoDate",
  title: "Unix timestamp → ISO date",
  category: "Date",
  paramsSchema: {
    type: "object",
    properties: {
      unit: { type: "string", enum: ["s", "ms"] },
    },
    required: ["unit"],
  } as DataPortSchema,
  inferOutputSchema: () => isoSchema,
  apply: (v, { unit }) => {
    const n = Number(v);
    return new Date(unit === "s" ? n * 1000 : n).toISOString();
  },
  suggestFromSchemas(source, target) {
    const s = source as any;
    if (s?.type !== "number" && s?.type !== "integer") return undefined;
    if (!hasDateTimeFormat(target)) return undefined;
    // Without semantic hints we don't know the unit; prefer "s" because
    // most unix timestamps in the wild are seconds.
    return { score: 0.85, params: { unit: "s" } };
  },
};

export const isoDateToUnixTransform: ITransformDef<Record<string, never>> = {
  id: "isoDateToUnix",
  title: "ISO date → Unix ms",
  category: "Date",
  paramsSchema: undefined,
  inferOutputSchema: () => numberSchema,
  apply: (v) => new Date(String(v)).getTime(),
  suggestFromSchemas(source, target) {
    if (!hasDateTimeFormat(source)) return undefined;
    const t = target as any;
    if (t?.type !== "number" && t?.type !== "integer") return undefined;
    return { score: 0.9, params: {} };
  },
};
