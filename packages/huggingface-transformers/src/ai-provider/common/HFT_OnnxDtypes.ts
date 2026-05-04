/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export const ONNX_QUANTIZATION_SUFFIX_MAPPING = {
  fp32: "",
  fp16: "_fp16",
  int8: "_int8",
  uint8: "_uint8",
  q8: "_quantized",
  q4: "_q4",
  q4f16: "_q4f16",
  bnb4: "_bnb4",
  q2: "_q2",
  q2f16: "_q2f16",
  q1: "_q1",
  q1f16: "_q1f16",
} as const;

export type OnnxQuantization = keyof typeof ONNX_QUANTIZATION_SUFFIX_MAPPING;

const SUFFIXES_LONGEST_FIRST = (
  Object.entries(ONNX_QUANTIZATION_SUFFIX_MAPPING) as [OnnxQuantization, string][]
)
  .filter(([, suffix]) => suffix !== "")
  .sort((a, b) => b[1].length - a[1].length);

export function parseOnnxQuantizations(params: {
  /** File paths, e.g. from listModels/modelInfo with additionalFields: ["filePaths"] */
  filePaths: string[];
  /** Subdirectory containing ONNX files. @default "onnx" */
  subfolder?: string;
}): OnnxQuantization[] {
  const subfolder = params.subfolder ?? "onnx";
  const prefix = subfolder + "/";

  const stems: string[] = [];
  for (const fp of params.filePaths) {
    if (!fp.startsWith(prefix)) continue;
    if (!fp.endsWith(".onnx")) continue;
    if (fp.endsWith(".onnx_data")) continue;
    stems.push(fp.slice(prefix.length, -".onnx".length));
  }

  if (stems.length === 0) return [];

  const parsed: Array<{ baseName: string; dtype: OnnxQuantization }> = [];
  for (const stem of stems) {
    let matched = false;
    for (const [dtype, suffix] of SUFFIXES_LONGEST_FIRST) {
      if (stem.endsWith(suffix)) {
        parsed.push({ baseName: stem.slice(0, -suffix.length), dtype });
        matched = true;
        break;
      }
    }
    if (!matched) {
      parsed.push({ baseName: stem, dtype: "fp32" });
    }
  }

  const allBaseNames = new Set(parsed.map((p) => p.baseName));
  const byDtype = new Map<OnnxQuantization, Set<string>>();
  for (const { baseName, dtype } of parsed) {
    let set = byDtype.get(dtype);
    if (!set) {
      set = new Set();
      byDtype.set(dtype, set);
    }
    set.add(baseName);
  }

  const allDtypes = Object.keys(ONNX_QUANTIZATION_SUFFIX_MAPPING) as OnnxQuantization[];
  return allDtypes.filter((dtype) => {
    const set = byDtype.get(dtype);
    return set !== undefined && set.size === allBaseNames.size;
  });
}
