/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
} from "@workglow/ai";
import { createPartialJsonStream, parsePartialJson } from "@workglow/util/worker";
import { buildGenaiPrompt, resolveTfmpChatTemplate } from "./TFMP_ChatTemplate";
import { generateGenaiResponse, getGenaiLlm, withGenaiLock } from "./TFMP_GenaiRuntime";
import type { TFMPModelConfig } from "./TFMP_ModelSchema";

function buildStructuredGenerationPrompt(input: StructuredGenerationTaskInput): string {
  const schemaStr = JSON.stringify(input.outputSchema, null, 2);
  return (
    `${input.prompt}\n\n` +
    `You MUST respond with ONLY a valid JSON object conforming to this JSON schema:\n${schemaStr}\n\n` +
    `Output ONLY the JSON object, no other text.`
  );
}

/**
 * Strip a Markdown code fence (``` or ```json) wrapping the payload, if present.
 * Surrounding whitespace is left on the capture; the caller trims it (matching
 * it here would make the pattern ambiguous and super-linear).
 */
function stripCodeFences(text: string): string {
  const fenceMatch = text.match(/```(?:json)?([\s\S]*?)```/);
  return fenceMatch ? fenceMatch[1] : text;
}

export function extractJsonFromText(text: string): Record<string, unknown> {
  const cleaned = stripCodeFences(text).trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return (parsePartialJson(match[0]) as Record<string, unknown>) ?? {};
      }
    }
    // Output truncated mid-object never closes its brace, so the balanced-object
    // match above finds nothing; recover whatever was emitted after the first `{`.
    const start = cleaned.indexOf("{");
    if (start !== -1) {
      return (parsePartialJson(cleaned.slice(start)) as Record<string, unknown>) ?? {};
    }
    return {};
  }
}

/**
 * `["text.generation", "json-mode"]` run-fn. MediaPipe web has no constrained
 * decoding, so JSON conformance is prompt-engineered; StructuredGenerationTask
 * validates the parsed object against the schema and retries on failure. The
 * parsed final object rides in `finish.data.object` per the structured
 * generation convention.
 */
export const TFMP_StructuredGeneration: AiProviderRunFn<
  StructuredGenerationTaskInput,
  StructuredGenerationTaskOutput,
  TFMPModelConfig
> = async (input, model, signal, emit) => {
  const template = resolveTfmpChatTemplate(
    (model!.provider_config as { chat_template?: string }).chat_template
  );
  const prompt = buildGenaiPrompt(
    [{ role: "user", content: buildStructuredGenerationPrompt(input) }],
    template
  );

  // The parser discards any prose or code fence ahead of the first '{', so the
  // pieces stream straight in with no accumulated copy to re-scan.
  const json = createPartialJsonStream({ skipPreamble: true });

  await withGenaiLock(model!.provider_config.model_path, async () => {
    const llm = await getGenaiLlm(model!, emit, signal);
    await generateGenaiResponse(llm, prompt, signal, (piece) => {
      const partial = json.push(piece);
      if (partial !== undefined) {
        emit({ type: "object-delta", port: "object", objectDelta: partial });
        return;
      }
      emit({ type: "text-delta", port: "text", textDelta: piece });
    });
  });

  emit({ type: "finish", data: { object: json.finishObject() } as StructuredGenerationTaskOutput });
};
