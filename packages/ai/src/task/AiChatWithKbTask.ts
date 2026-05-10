/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, StreamEvent } from "@workglow/task-graph";
import { TaskConfigSchema } from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { AiJobInput } from "../job/AiJob";
import type { ModelConfig } from "../model/ModelSchema";
import { getAiProviderRegistry } from "../provider/AiProviderRegistry";
import { TypeModel } from "./base/AiTaskSchemas";
import { StreamingAiTask } from "./base/StreamingAiTask";
import type { ChatMessage, ContentBlock } from "./ChatMessage";
import { ChatMessageSchema, ContentBlockSchema } from "./ChatMessage";
import { resolveHumanConnector } from "@workglow/util";
import type { IHumanRequest } from "@workglow/util";
import type { ChunkSearchResult, KnowledgeBase } from "@workglow/knowledge-base";
import { getKnowledgeBase } from "@workglow/knowledge-base";
import { KbSearchTask } from "./KbSearchTask";
import {
  buildResponseFormatAddendum,
  KB_INLINE_CITATION_DIRECTIVE,
  type ResponseFormat,
} from "./base/responseFormat";

// ========================================================================
// Public types
// ========================================================================

export interface ChatChunkReference {
  readonly kbId: string;
  readonly kbLabel: string;
  readonly title: string;
  readonly url: string | undefined;
  readonly snippet: string;
  readonly score: number;
  /**
   * 1-based position of this chunk in the prompt the model sees, so the
   * model's reply citing `[N]` maps back to this entry. `0` for
   * author-supplied `noMatchReferences` (which don't correspond to any
   * prompt chunk).
   */
  readonly index: number;
}

// ========================================================================
// Schemas
// ========================================================================

const modelSchema = TypeModel("model:AiChatWithKbTask");

const chatChunkReferenceSchema = {
  type: "object",
  properties: {
    kbId: { type: "string" },
    kbLabel: { type: "string" },
    title: { type: "string" },
    url: { type: "string" },
    snippet: { type: "string" },
    score: { type: "number" },
    index: { type: "number" },
  },
  required: ["kbId", "kbLabel", "title", "snippet", "score", "index"],
} as const satisfies DataPortSchema;

/**
 * Connector elicit schema. The connector side renders a plain text field
 * for this — chat UIs let the user type a message, not author a JSON
 * ContentBlock array. AiChatWithKbTask wraps the string into
 * `[{ type: "text", text }]` before appending to the conversation.
 *
 * `content` is intentionally optional: submitting an empty message ends
 * the conversation (the chat loop treats empty content as "done").
 */
const chatConnectorContentSchema = {
  type: "object",
  properties: {
    content: {
      type: "string",
      title: "Message",
      description: "Your reply (leave blank to end the conversation)",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const AiChatWithKbInputSchema = {
  type: "object",
  properties: {
    model: modelSchema,
    prompt: {
      oneOf: [
        { type: "string", title: "Prompt", description: "The initial user message" },
        {
          type: "array",
          title: "Prompt",
          description: "The initial user message as structured content blocks",
          items: ContentBlockSchema,
        },
      ],
      title: "Prompt",
      description: "The first user message to start the conversation",
    },
    messages: {
      type: "array",
      title: "Messages",
      description:
        "Conversation history (managed internally by the chat loop; not a user-facing input)",
      items: ChatMessageSchema,
      "x-ui-hidden": true,
    },
    systemPrompt: {
      type: "string",
      title: "System Prompt",
      description: "Optional system instructions for the model",
    },
    maxTokens: {
      type: "number",
      title: "Max Tokens",
      description: "Per-turn token limit",
      minimum: 1,
      "x-ui-group": "Configuration",
    },
    temperature: {
      type: "number",
      title: "Temperature",
      description: "Sampling temperature",
      minimum: 0,
      maximum: 2,
      "x-ui-group": "Configuration",
    },
    maxIterations: {
      type: "number",
      title: "Max Iterations",
      description: "Safety cap on conversation turns",
      minimum: 1,
      default: 100,
      "x-ui-group": "Configuration",
    },
    knowledgeBaseIds: {
      type: "array",
      title: "Knowledge Base IDs",
      description: "Knowledge bases to retrieve from on each turn",
      items: { type: "string" },
    },
    topKPerKb: {
      type: "number",
      title: "Top K per KB",
      description: "Top results per KB before threshold filtering",
      minimum: 1,
      default: 4,
      "x-ui-group": "Configuration",
    },
    minScore: {
      type: "number",
      title: "Min score",
      description: "Score floor for a chunk to count as a useful match",
      minimum: 0,
      maximum: 1,
      default: 0.3,
      "x-ui-group": "Configuration",
    },
    maxReferences: {
      type: "number",
      title: "Max references",
      description: "Cap on the chunk references emitted per turn",
      minimum: 1,
      default: 6,
      "x-ui-group": "Configuration",
    },
    noMatchReply: {
      type: "string",
      title: "No-match reply",
      description:
        "When set and zero chunks match: emit this verbatim and skip the provider",
      "x-ui-group": "Configuration",
    },
    noMatchReferences: {
      type: "array",
      title: "No-match references",
      description:
        "When set and zero chunks match: emit these verbatim on the references port",
      items: chatChunkReferenceSchema,
      "x-ui-group": "Configuration",
    },
    responseFormat: {
      type: "string",
      enum: ["text", "markdown"],
      default: "text",
      title: "Response format",
      description:
        "How the model is instructed to format replies. 'text' = plain text. " +
        "'markdown' = GitHub-flavored Markdown; citations are emitted as inline " +
        "[anchor](url) links instead of [N] numbers.",
      "x-ui-group": "Configuration",
    },
  },
  required: ["model", "prompt", "knowledgeBaseIds"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const AiChatWithKbOutputSchema = {
  type: "object",
  properties: {
    text: {
      type: "string",
      title: "Text",
      description: "Last assistant response",
      "x-stream": "append",
    },
    messages: {
      type: "array",
      title: "Messages",
      description: "Full conversation history",
      items: ChatMessageSchema,
      "x-stream": "object",
    },
    iterations: {
      type: "number",
      title: "Iterations",
      description: "Number of completed turns",
    },
    references: {
      type: "array",
      title: "References",
      description:
        "Per-chunk citation references emitted each turn (one entry per surviving chunk; not deduped)",
      items: chatChunkReferenceSchema,
      "x-stream": "object",
    },
  },
  required: ["text", "messages", "iterations", "references"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

// ========================================================================
// Runtime types
// ========================================================================

export type AiChatWithKbTaskInput = Omit<
  FromSchema<typeof AiChatWithKbInputSchema>,
  "messages" | "noMatchReferences"
> & {
  readonly messages?: ReadonlyArray<ChatMessage>;
  readonly noMatchReferences?: ReadonlyArray<ChatChunkReference>;
};

export type AiChatWithKbTaskOutput = Omit<
  FromSchema<typeof AiChatWithKbOutputSchema>,
  "references"
> & {
  readonly references: readonly ChatChunkReference[];
};

// ========================================================================
// Task class
// ========================================================================

export class AiChatWithKbTask extends StreamingAiTask<
  AiChatWithKbTaskInput,
  AiChatWithKbTaskOutput
> {
  public static override type = "AiChatWithKbTask";
  protected static override readonly streamingPhaseLabel = "Replying";
  public static override category = "AI Chat";
  public static override title = "AI Chat (Knowledge Base)";
  public static override description =
    "Multi-turn chat grounded in one or more knowledge bases. Retrieves on every user turn, injects numbered context, and emits structured per-chunk citation references.";
  public static override cacheable = false;

  public static override configSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        ...TaskConfigSchema["properties"],
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override inputSchema(): DataPortSchema {
    return AiChatWithKbInputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return AiChatWithKbOutputSchema as DataPortSchema;
  }

  private _sessionId: string | undefined;

  protected override async getJobInput(
    input: AiChatWithKbTaskInput
  ): Promise<AiJobInput<AiChatWithKbTaskInput>> {
    const model = input.model as ModelConfig;
    if (!this._sessionId) {
      this._sessionId = getAiProviderRegistry().createSession(model.provider, model);
    }
    return {
      taskType: "AiChatWithKbTask",
      aiProvider: model.provider,
      taskInput: input as AiChatWithKbTaskInput & { model: ModelConfig },
      sessionId: this._sessionId,
    };
  }

  override async *executeStream(
    input: AiChatWithKbTaskInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<AiChatWithKbTaskOutput>> {
    // Reset session so re-running the task starts a fresh conversation.
    this._sessionId = undefined;

    const model = input.model as ModelConfig;
    if (!model || typeof model !== "object") {
      throw new Error("AiChatWithKbTask: model was not resolved to ModelConfig");
    }
    const connector = resolveHumanConnector(context);

    // Build initial history.
    const history: ChatMessage[] = [];
    if (input.systemPrompt) {
      history.push({ role: "system", content: [{ type: "text", text: input.systemPrompt }] });
    }
    const firstUserBlocks: ReadonlyArray<ContentBlock> =
      typeof input.prompt === "string"
        ? [{ type: "text", text: input.prompt }]
        : (input.prompt as ReadonlyArray<ContentBlock>);
    history.push({ role: "user", content: firstUserBlocks });

    // Call getJobInput once before the loop to initialize _sessionId.
    const workingInput: AiChatWithKbTaskInput = { ...input, messages: history };
    await this.getJobInput(workingInput);
    const maxIterations = input.maxIterations ?? 100;

    // Register session disposal so it's cleaned up at end of the resource scope.
    if (context.resourceScope && this._sessionId) {
      const sessionId = this._sessionId;
      context.resourceScope.register(`ai:session:${sessionId}`, async () => {
        await getAiProviderRegistry().disposeSession(model.provider, sessionId);
      });
    }

    // Emit the initial messages as an object-delta.
    yield {
      type: "object-delta",
      port: "messages",
      objectDelta: [...history],
    } as StreamEvent<AiChatWithKbTaskOutput>;

    const topK = input.topKPerKb ?? 4;
    const minScore = input.minScore ?? 0.3;
    const maxRefs = input.maxReferences ?? 6;

    for (let turn = 0; turn < maxIterations; turn++) {
      const lastUserText = extractLastUserText(history);

      // Retrieve from all knowledge bases in parallel. Keep the kb instance
      // alongside results so we can fetch per-doc metadata for URL resolution
      // — chunks don't inherit `url`/`sourceUri` from their document at upsert
      // time (only `doc_title` is propagated by ChunkVectorUpsertTask), so
      // dedup-by-URL on the consumer side requires resolving URLs from the
      // document record after retrieval.
      let perKbResults: Array<{
        kbId: string;
        kbLabel: string;
        kb: KnowledgeBase | undefined;
        results: ChunkSearchResult[];
      }> = [];
      if (lastUserText.length > 0) {
        perKbResults = await Promise.all(
          (input.knowledgeBaseIds ?? []).map(async (kbId) => {
            const kb = getKnowledgeBase(kbId);
            if (!kb) {
              console.warn(`[AiChatWithKbTask] knowledge base "${kbId}" not registered`);
              return { kbId, kbLabel: kbId, kb: undefined, results: [] as ChunkSearchResult[] };
            }
            const search = context.own(new KbSearchTask());
            const out = await search.run({
              knowledgeBase: kb as KnowledgeBase,
              query: lastUserText,
              topK,
            });
            return { kbId, kbLabel: kb.title || kbId, kb: kb as KnowledgeBase, results: out.results };
          })
        );
      }

      // Merge, threshold, sort, cap, and number the chunks.
      const allChunks = perKbResults
        .flatMap(({ kbId, kbLabel, kb, results }) =>
          results
            .filter((r) => r.score >= minScore)
            .map((r) => ({ kbId, kbLabel, kb, r }))
        )
        .sort((a, b) => b.r.score - a.r.score)
        .slice(0, maxRefs);

      // Resolve a URL per unique (kb, doc_id) by reading the document record's
      // metadata.url (preferred) or metadata.sourceUri (fallback). One IDB
      // lookup per unique doc; cheap given maxRefs is small.
      const docUrls = new Map<string, string | undefined>();
      const docFetches: Array<Promise<void>> = [];
      for (const { kb, r } of allChunks) {
        if (!kb) continue;
        const key = `${r.doc_id}`;
        if (docUrls.has(key)) continue;
        docUrls.set(key, undefined);
        docFetches.push(
          kb
            .getDocument(r.doc_id)
            .then((doc) => {
              const md = (doc?.metadata ?? {}) as { url?: unknown; sourceUri?: unknown };
              const url =
                typeof md.url === "string"
                  ? md.url
                  : typeof md.sourceUri === "string"
                    ? md.sourceUri
                    : undefined;
              docUrls.set(key, url);
            })
            .catch(() => {
              // leave the slot as undefined so the chip renders without a URL
            })
        );
      }
      await Promise.all(docFetches);

      const refs: ChatChunkReference[] = allChunks.map((entry, i) =>
        buildChunkReference({
          index: i + 1,
          kbId: entry.kbId,
          kbLabel: entry.kbLabel,
          result: entry.r,
          url: docUrls.get(entry.r.doc_id),
        })
      );

      const emitted: ChatChunkReference[] =
        refs.length > 0
          ? refs
          : (input.noMatchReferences as ChatChunkReference[] | undefined) ?? [];

      yield {
        type: "object-delta",
        port: "references",
        objectDelta: emitted,
      } as StreamEvent<AiChatWithKbTaskOutput>;

      let assistantText = "";
      if (refs.length === 0 && input.noMatchReply) {
        yield {
          type: "text-delta",
          port: "text",
          textDelta: input.noMatchReply,
        } as StreamEvent<AiChatWithKbTaskOutput>;
        assistantText = input.noMatchReply;
      } else {
        // Build a per-turn system prompt that includes the retrieved context.
        const addendum = buildResponseFormatAddendum(input.responseFormat);
        const directive =
          input.responseFormat === "markdown" ? KB_INLINE_CITATION_DIRECTIVE : "";
        const userSystemPrompt = input.systemPrompt ?? "";
        const turnSystemPrompt = [
          userSystemPrompt,
          addendum,
          directive,
          "--- Context ---",
          formatChunksForPrompt(refs, input.responseFormat),
        ]
          .filter((s) => s.length > 0)
          .join("\n\n");
        const perTurnInput: AiChatWithKbTaskInput = {
          ...input,
          messages: [
            { role: "system", content: [{ type: "text", text: turnSystemPrompt }] },
            ...history.filter((m) => m.role !== "system"),
          ],
          systemPrompt: turnSystemPrompt,
        };
        const turnJobInput = await this.getJobInput(perTurnInput);
        const strategy = getAiProviderRegistry().getStrategy(model);

        for await (const event of strategy.executeStream(
          turnJobInput as any,
          context,
          this.runConfig.runnerId
        )) {
          if (event.type === "text-delta") {
            assistantText += (event as any).textDelta;
            yield {
              ...event,
              port: (event as any).port ?? "text",
            } as StreamEvent<AiChatWithKbTaskOutput>;
          } else if (event.type === "finish") {
            // swallow — we emit our own finish at the end
          } else {
            yield event as StreamEvent<AiChatWithKbTaskOutput>;
          }
        }
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: [{ type: "text", text: assistantText }],
      };
      history.push(assistantMsg);
      yield {
        type: "object-delta",
        port: "messages",
        objectDelta: [assistantMsg],
      } as StreamEvent<AiChatWithKbTaskOutput>;

      // Ask the human for the next turn.
      const request: IHumanRequest = {
        requestId: crypto.randomUUID(),
        targetHumanId: "default",
        kind: "elicit",
        message: "",
        contentSchema: chatConnectorContentSchema,
        contentData: undefined,
        expectsResponse: true,
        mode: "multi-turn",
        metadata: { iteration: turn, taskId: this.id },
      };

      const response = await connector.send(request, context.signal);
      if (response.action === "cancel" || response.action === "decline") break;

      const raw = response.content?.content;
      let userContent: ContentBlock[];
      if (typeof raw === "string") {
        const text = raw.trim();
        userContent = text.length > 0 ? [{ type: "text", text: raw }] : [];
      } else if (Array.isArray(raw)) {
        userContent = raw as ContentBlock[];
      } else {
        userContent = [];
      }
      if (userContent.length === 0) break;

      const userMsg: ChatMessage = { role: "user", content: userContent };
      history.push(userMsg);
      yield {
        type: "object-delta",
        port: "messages",
        objectDelta: [userMsg],
      } as StreamEvent<AiChatWithKbTaskOutput>;
    }

    // Bare finish — no data payload.
    yield { type: "finish" } as StreamEvent<AiChatWithKbTaskOutput>;
  }
}

// ========================================================================
// Helpers (module-level, no shared mutable state)
// ========================================================================

function extractLastUserText(messages: readonly ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    const text = m.content
      .map((b) => (b.type === "text" ? (b as { type: "text"; text: string }).text : ""))
      .join(" ")
      .trim();
    if (text.length > 0) return text;
  }
  return "";
}

interface BuildChunkRefArgs {
  index: number;
  kbId: string;
  kbLabel: string;
  result: ChunkSearchResult;
  /**
   * URL resolved from the document record's metadata (preferred over any URL
   * on the chunk metadata, which is typically absent — `ChunkVectorUpsertTask`
   * propagates only `doc_title` from doc to chunk).
   */
  url: string | undefined;
}

function buildChunkReference(args: BuildChunkRefArgs): ChatChunkReference {
  const md = (args.result.metadata ?? {}) as {
    doc_title?: string;
    title?: string;
    text?: string;
    url?: string;
    sourceUri?: string;
  };
  const title = md.doc_title ?? md.title ?? args.result.doc_id ?? "Untitled";
  const url = args.url ?? md.url ?? md.sourceUri ?? undefined;
  const text = md.text ?? "";
  const snippet = text.length > 150 ? text.slice(0, 150).trim() + "…" : text;
  return {
    index: args.index,
    kbId: args.kbId,
    kbLabel: args.kbLabel,
    title,
    url,
    snippet,
    score: args.result.score,
  };
}

function formatChunksForPrompt(
  refs: readonly ChatChunkReference[],
  responseFormat: ResponseFormat | undefined
): string {
  return refs
    .map((r) => {
      const head = `[${r.index}] [${r.kbLabel}] (${r.title})`;
      if (responseFormat === "markdown" && r.url) {
        return `${head} <${r.url}>\n    ${r.snippet}`;
      }
      return `${head} ${r.snippet}`;
    })
    .join("\n\n");
}
