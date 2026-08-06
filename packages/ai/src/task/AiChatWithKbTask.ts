/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChunkSearchResult, KnowledgeBase } from "@workglow/knowledge-base";
import { getKnowledgeBase, slugifyHeading } from "@workglow/knowledge-base";
import type {
  CachePolicy,
  IExecuteContext,
  StreamEvent,
  TaskInput,
  Usage,
} from "@workglow/task-graph";
import { mergeUsage, TaskConfigSchema, USAGE_OUTPUT_KEY } from "@workglow/task-graph";
import type { IHumanRequest } from "@workglow/util";
import { DEFAULT_LIMITS, resolveHumanConnector } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import { recordUsageTelemetry } from "../capability/UsageTelemetry";
import type { AiJobInput } from "../job/AiJob";
import type { ModelConfig } from "../model/ModelSchema";
import { getAiProviderRegistry } from "../provider/AiProviderRegistry";
import { TypeModel } from "./base/AiTaskSchemas";
import { runChatTurn } from "./base/chatTurn";
import {
  buildResponseFormatAddendum,
  KB_INLINE_CITATION_DIRECTIVE,
  type ResponseFormat,
} from "./base/responseFormat";
import { StreamingAiTask } from "./base/StreamingAiTask";
import type { ChatMessage, ContentBlock } from "./ChatMessage";
import { ChatMessageSchema, ContentBlockSchema } from "./ChatMessage";
import { KbSearchTask } from "./KbSearchTask";
import { TextEmbeddingTask } from "./TextEmbeddingTask";

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
    embeddingModel: {
      ...TypeModel("model:TextEmbeddingTask"),
      title: "Embedding Model",
      description:
        "Optional text embedding model used to retrieve directly inside this chat run. " +
        "When omitted, each knowledge base's onSearch callback handles retrieval.",
    },
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
      description: "When set and zero chunks match: emit this verbatim and skip the provider",
      "x-ui-group": "Configuration",
    },
    noMatchReferences: {
      type: "array",
      title: "No-match references",
      description: "When set and zero chunks match: emit these verbatim on the references port",
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
      // `x-stream: append` concatenates every `text-delta` from every turn,
      // so the accumulated value is the full transcript across turns — not
      // just the last assistant response. Consumers that need the most
      // recent assistant message should read it off the `messages` port
      // instead.
      description: "Full streamed transcript across all assistant turns",
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

export type AiChatWithKbTaskInput = Omit<
  {
    systemPrompt?: string | undefined;
    messages?: ChatMessage[] | undefined;
    maxTokens?: number | undefined;
    temperature?: number | undefined;
    maxIterations?: number | undefined;
    responseFormat?: "text" | "markdown" | undefined;
    embeddingModel?: unknown;
    topKPerKb?: number | undefined;
    minScore?: number | undefined;
    maxReferences?: number | undefined;
    noMatchReply?: string | undefined;
    noMatchReferences?:
      | {
          [x: string]: unknown;
          url?: string | undefined;
          title: string;
          score: number;
          kbId: string;
          kbLabel: string;
          snippet: string;
          index: number;
        }[]
      | undefined;
    model: string | ModelConfig;
    prompt:
      | string
      | (
          | { type: "text"; text: string }
          | { type: "image"; mimeType: string; data: string }
          | {
              type: "tool_use";
              id: string;
              name: string;
              input: { [x: string]: unknown };
              providerSignature?: string | undefined;
            }
          | {
              is_error?: boolean | undefined;
              type: "tool_result";
              content: (
                | { type: "text"; text: string }
                | { type: "image"; mimeType: string; data: string }
                | {
                    type: "tool_use";
                    id: string;
                    name: string;
                    input: { [x: string]: unknown };
                    providerSignature?: string | undefined;
                  }
              )[];
              tool_use_id: string;
            }
        )[];
    knowledgeBaseIds: string[];
  },
  "messages" | "noMatchReferences"
> & {
  readonly messages?: ReadonlyArray<ChatMessage>;
  readonly noMatchReferences?: ReadonlyArray<ChatChunkReference>;
};

export type AiChatWithKbTaskOutput = Omit<
  {
    text: string;
    messages: ChatMessage[];
    references: {
      [x: string]: unknown;
      url?: string | undefined;
      title: string;
      score: number;
      kbId: string;
      kbLabel: string;
      snippet: string;
      index: number;
    }[];
    iterations: number;
  },
  "references"
> & { readonly references: readonly ChatChunkReference[] };

export class AiChatWithKbTask extends StreamingAiTask<
  AiChatWithKbTaskInput,
  AiChatWithKbTaskOutput
> {
  public static override type = "AiChatWithKbTask";
  public static override readonly requires = ["text.generation"] as const satisfies Capability[];
  protected static override readonly streamingPhaseLabel = "Replying";
  public static override category = "AI Chat";
  public static override title = "AI Chat (Knowledge Base)";
  public static override description =
    "Multi-turn chat grounded in one or more knowledge bases. Retrieves on every user turn, injects numbered context, and emits structured per-chunk citation references.";
  public static override cachePolicy: CachePolicy = { kind: "none" };

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
    // Delegate to base so timeoutMs, outputSchema, and any future base fields
    // are always populated; set sessionId afterwards so it stays a top-level
    // job field and is not embedded in the serialized taskInput.
    const jobInput = await super.getJobInput(input);
    jobInput.sessionId = this._sessionId;
    return jobInput;
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

    // Strict gating: this override doesn't call super.executeStream, so we
    // must gate here to match the contract AiTask.execute and
    // StreamingAiTask.executeStream both enforce.
    this.gateOrThrow(model);

    const connector = resolveHumanConnector(context);

    const embeddingModel = input.embeddingModel as ModelConfig | undefined;

    const history: ChatMessage[] = [];
    if (input.systemPrompt) {
      history.push({ role: "system", content: [{ type: "text", text: input.systemPrompt }] });
    }
    const firstUserBlocks: ReadonlyArray<ContentBlock> =
      typeof input.prompt === "string"
        ? [{ type: "text", text: input.prompt }]
        : (input.prompt as ReadonlyArray<ContentBlock>);
    history.push({ role: "user", content: firstUserBlocks });

    // Initialize _sessionId before the loop.
    const workingInput: AiChatWithKbTaskInput = { ...input, messages: history };
    await this.getJobInput(workingInput);
    const maxIterations = input.maxIterations ?? DEFAULT_LIMITS.aiChatMaxIterations;

    if (context.resourceScope && this._sessionId) {
      const sessionId = this._sessionId;
      context.resourceScope.register(`ai:session:${sessionId}`, async () => {
        await getAiProviderRegistry().disposeSession(model.provider, sessionId);
      });
    }

    yield {
      type: "object-delta",
      port: "messages",
      objectDelta: [...history],
    } as StreamEvent<AiChatWithKbTaskOutput>;

    const topK = input.topKPerKb ?? 4;
    const minScore = input.minScore ?? 0.3;
    const maxRefs = input.maxReferences ?? 6;

    // Incremented after each completed assistant turn — emitted via
    // `finish.data.iterations` at the end so the output schema's required
    // `iterations` field is populated. (The streaming accumulator merges
    // `finish.data` over accumulated stream values; no `x-stream`
    // declaration applies to a one-shot scalar like this.)
    let completedTurns = 0;

    // Carries the most recent turn's surviving chunks forward so a short
    // follow-up ("tell me more", "what about X?") that wouldn't match the
    // KB on its own still has the prior turn's context to answer from.
    // Reset only on a turn that itself produces hits — so a fresh topic
    // shift naturally replaces the carry-forward set on the next match.
    let lastNonEmptyRefs: readonly ChatChunkReference[] = [];

    // Token accounting for the whole conversation. Each turn is its own provider
    // request, and only the outer finish reaches the caller, so the per-turn
    // counts have to be summed here or the run under-reports its cost by every
    // turn but the last.
    let conversationUsage: Usage | undefined;

    // `finally`, not a trailing call: a consumer that stops the chat early
    // closes this generator at a `yield` and never reaches the statement
    // after the loop — but the turns it already drove were still billed.
    // Recorded once per conversation, not once per turn: telemetry counts
    // one run's token accounting, and a chat run is one run.
    try {
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
          let queryVector: Float32Array | undefined;
          if (embeddingModel) {
            const embeddingTask = context.own(new TextEmbeddingTask());
            const embeddingResult = await embeddingTask.run(
              {
                text: lastUserText,
                model: embeddingModel,
              },
              { resourceScope: context.resourceScope }
            );
            const vector = Array.isArray(embeddingResult.vector)
              ? embeddingResult.vector[0]
              : embeddingResult.vector;
            queryVector = vector instanceof Float32Array ? vector : new Float32Array(vector);
          }

          perKbResults = await Promise.all(
            (input.knowledgeBaseIds ?? []).map(async (kbId) => {
              const kb = getKnowledgeBase(kbId);
              if (!kb) {
                console.warn(`[AiChatWithKbTask] knowledge base "${kbId}" not registered`);
                return { kbId, kbLabel: kbId, kb: undefined, results: [] as ChunkSearchResult[] };
              }
              try {
                let results: ChunkSearchResult[];
                if (queryVector) {
                  results = await (kb as KnowledgeBase).similaritySearch(queryVector, { topK });
                } else {
                  const search = context.own(new KbSearchTask());
                  const out = await search.run({
                    knowledgeBase: kb as KnowledgeBase,
                    query: lastUserText,
                    topK,
                  });
                  results = out.results;
                }
                return {
                  kbId,
                  kbLabel: kb.title || kbId,
                  kb: kb as KnowledgeBase,
                  results,
                };
              } catch (error) {
                // A single KB's embedding/search failure must not abort the turn;
                // degrade to empty results for that KB so other KBs still contribute.
                console.warn(`[AiChatWithKbTask] knowledge base "${kbId}" search failed`, error);
                return {
                  kbId,
                  kbLabel: kb.title || kbId,
                  kb: kb as KnowledgeBase,
                  results: [] as ChunkSearchResult[],
                };
              }
            })
          );
        }

        const allChunks = perKbResults
          .flatMap(({ kbId, kbLabel, kb, results }) =>
            results.filter((r) => r.score >= minScore).map((r) => ({ kbId, kbLabel, kb, r }))
          )
          .sort((a, b) => b.r.score - a.r.score)
          .slice(0, maxRefs);

        // Resolve a URL per unique (kb, doc_id) by reading the document record's
        // metadata.url (the public route written by the ingest workflow).
        // One lookup per unique doc; cheap given maxRefs is small.

        const docUrlKey = (kbId: string, docId: string): string => `${kbId}:${docId}`;
        const docUrls = new Map<string, string | undefined>();
        const docFetches: Array<Promise<void>> = [];
        for (const { kbId, kb, r } of allChunks) {
          if (!kb) continue;
          const key = docUrlKey(kbId, r.doc_id);
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
            url: docUrls.get(docUrlKey(entry.kbId, entry.r.doc_id)),
          })
        );

        // Follow-up carry-forward: when this turn produced no hits but a
        // previous turn did, treat the prior refs as the effective context
        // instead of firing the no-match path. Short follow-ups like "tell
        // me more" or "and on mobile?" would otherwise drop the user out of
        // the conversation thread.
        const effectiveRefs: readonly ChatChunkReference[] =
          refs.length > 0 ? refs : lastNonEmptyRefs;
        if (refs.length > 0) {
          lastNonEmptyRefs = refs;
        }

        const emitted: ChatChunkReference[] =
          effectiveRefs.length > 0
            ? [...effectiveRefs]
            : ((input.noMatchReferences as ChatChunkReference[] | undefined) ?? []);

        yield {
          type: "object-delta",
          port: "references",
          objectDelta: emitted,
        } as StreamEvent<AiChatWithKbTaskOutput>;

        let assistantText = "";
        if (effectiveRefs.length === 0 && input.noMatchReply) {
          yield {
            type: "text-delta",
            port: "text",
            textDelta: input.noMatchReply,
          } as StreamEvent<AiChatWithKbTaskOutput>;
          assistantText = input.noMatchReply;
        } else {
          // Build a per-turn system prompt that includes the retrieved context.
          const addendum = buildResponseFormatAddendum(input.responseFormat);
          const directive = input.responseFormat === "markdown" ? KB_INLINE_CITATION_DIRECTIVE : "";
          const userSystemPrompt = input.systemPrompt ?? "";
          const turnSystemPrompt = [
            userSystemPrompt,
            addendum,
            directive,
            "--- Context ---",
            formatChunksForPrompt(effectiveRefs, input.responseFormat),
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

          // The shared seam accumulates this turn's text and swallows the
          // inner-turn `finish` (the outer `finish` is emitted at the end),
          // keeping its `usage` sibling for the conversation total.
          const turn_ = runChatTurn<AiChatWithKbTaskOutput>({
            strategy,
            jobInput: turnJobInput as unknown as AiJobInput<TaskInput>,
            context,
            runnerId: this.runConfig.runnerId,
            textPort: "text",
          });
          // `finally`, not a trailing statement: a consumer that stops mid-turn
          // closes this generator at its `yield`, and the tokens that turn
          // already billed must still be accounted for.
          try {
            for await (const event of turn_.events) {
              yield event;
            }
          } finally {
            assistantText = turn_.text;
            conversationUsage = mergeUsage(conversationUsage, turn_.usage);
          }
        }

        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: [{ type: "text", text: assistantText }],
        };
        history.push(assistantMsg);
        completedTurns = turn + 1;
        yield {
          type: "object-delta",
          port: "messages",
          objectDelta: [assistantMsg],
        } as StreamEvent<AiChatWithKbTaskOutput>;

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

      // `text`, `messages`, and `references` ride the x-stream merge into the
      // final output. `iterations` has no x-stream, so we deliver it in
      // `finish.data` for the StreamProcessor to merge over the accumulated
      // ports.
      yield {
        type: "finish",
        data: { iterations: completedTurns } as Partial<AiChatWithKbTaskOutput>,
        ...(conversationUsage ? { usage: conversationUsage } : {}),
      } as StreamEvent<AiChatWithKbTaskOutput>;
    } finally {
      if (conversationUsage) {
        recordUsageTelemetry({ [USAGE_OUTPUT_KEY]: conversationUsage }, this.type, model.model_id);
      }
    }
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
    sectionTitles?: readonly string[];
  };
  const title = md.doc_title ?? md.title ?? args.result.doc_id ?? "Untitled";
  // No `md.sourceUri` fallback — sourceUri is the raw `/raw/<domain>/...`
  // path on legacy chunks. Letting it through would produce a clickable
  // chip routing to a non-existent page. Leaving the URL undefined
  // renders a chip without a click target instead.
  const baseUrl = args.url ?? md.url ?? undefined;
  // Append a `#anchor` for the chunk's deepest section so the link scrolls
  // directly to the relevant heading on the rendered page. The MDX rehype
  // pipeline must emit the same slug as an `id=` on each heading or this
  // won't scroll — they share `slugifyHeading` from @workglow/knowledge-base
  // for that reason.
  const url = withSectionAnchor(baseUrl, md.sectionTitles);
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

function withSectionAnchor(
  url: string | undefined,
  sectionTitles: readonly string[] | undefined
): string | undefined {
  if (!url) return url;
  // Don't double-fragment: if the URL already has a `#…`, leave it alone.
  if (url.includes("#")) return url;
  if (!sectionTitles || sectionTitles.length === 0) return url;
  const deepest = sectionTitles[sectionTitles.length - 1];
  if (typeof deepest !== "string") return url;
  const slug = slugifyHeading(deepest);
  if (slug.length === 0) return url;
  return `${url}#${slug}`;
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
