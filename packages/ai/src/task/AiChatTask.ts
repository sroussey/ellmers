/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, StreamEvent } from "@workglow/task-graph";
import { TaskConfigSchema } from "@workglow/task-graph";
import type { IHumanRequest } from "@workglow/util";
import { resolveHumanConnector } from "@workglow/util";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import type { Capability } from "../capability/Capabilities";
import type { AiJobInput } from "../job/AiJob";
import type { ModelConfig } from "../model/ModelSchema";
import { getAiProviderRegistry } from "../provider/AiProviderRegistry";
import { TypeModel } from "./base/AiTaskSchemas";
import { buildResponseFormatAddendum } from "./base/responseFormat";
import { StreamingAiTask } from "./base/StreamingAiTask";
import type { ChatMessage, ContentBlock } from "./ChatMessage";
import { ChatMessageSchema, ContentBlockSchema } from "./ChatMessage";

// ========================================================================
// Schemas
// ========================================================================

const modelSchema = TypeModel("model:AiChatTask");

/**
 * Connector elicit schema. The connector side renders a plain text field
 * for this — chat UIs let the user type a message, not author a JSON
 * ContentBlock array. AiChatTask wraps the string into
 * `[{ type: "text", text }]` before appending to the conversation.
 *
 * `content` is intentionally optional: submitting an empty message ends
 * the conversation (the chat loop treats empty content as "done"). A
 * consumer that wants to send structured content blocks directly (e.g.,
 * an image) can still bypass the elicit form and call `connector.send`
 * with `content: { content: ContentBlock[] }` — the task accepts both shapes.
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

export const AiChatInputSchema = {
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
    responseFormat: {
      type: "string",
      enum: ["text", "markdown"],
      default: "text",
      title: "Response format",
      description:
        "How the model is instructed to format replies. 'text' = plain text. " +
        "'markdown' = GitHub-flavored Markdown.",
      "x-ui-group": "Configuration",
    },
  },
  required: ["model", "prompt"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

export const AiChatOutputSchema = {
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
  },
  required: ["text", "messages", "iterations"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

// ========================================================================
// Runtime types
// ========================================================================

export type AiChatTaskInput = Omit<FromSchema<typeof AiChatInputSchema>, "messages"> & {
  readonly messages?: ReadonlyArray<ChatMessage>;
};

export type AiChatTaskOutput = FromSchema<typeof AiChatOutputSchema>;

/** Provider-facing input: same structural type as AiChatTaskInput, named separately for intent. */
export type AiChatProviderInput = AiChatTaskInput;

export interface AiChatProviderOutput {
  readonly text: string;
  [key: string]: unknown;
}

// ========================================================================
// Task class
// ========================================================================

export class AiChatTask extends StreamingAiTask<AiChatTaskInput, AiChatTaskOutput> {
  public static override type = "AiChatTask";
  /** Capabilities required of the model; gated in {@link StreamingAiTask.executeStream}. */
  public static override readonly requires: readonly Capability[] = [
    "text.generation",
  ] as const satisfies readonly Capability[];
  protected static override readonly streamingPhaseLabel = "Replying";
  public static override category = "AI Chat";
  public static override title = "AI Chat";
  public static override description =
    "Multi-turn chat with a language model, using a human connector to collect user input between turns.";
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
    return AiChatInputSchema as DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return AiChatOutputSchema as DataPortSchema;
  }

  private _sessionId: string | undefined;

  protected override async getJobInput(
    input: AiChatTaskInput
  ): Promise<AiJobInput<AiChatTaskInput>> {
    const model = input.model as ModelConfig;
    if (!this._sessionId) {
      this._sessionId = getAiProviderRegistry().createSession(model.provider, model);
    }
    // Delegate to base so timeoutMs, outputSchema, and any future base fields
    // are always populated. The base reads (input as any).sessionId and
    // forwards it into jobInput.sessionId, so we inject the session id here.
    return super.getJobInput({ ...input, sessionId: this._sessionId } as AiChatTaskInput & {
      sessionId: string;
    });
  }

  override async *executeStream(
    input: AiChatTaskInput,
    context: IExecuteContext
  ): AsyncIterable<StreamEvent<AiChatTaskOutput>> {
    // Reset session so re-running the task starts a fresh conversation.
    this._sessionId = undefined;

    const model = input.model as ModelConfig;
    if (!model || typeof model !== "object") {
      throw new Error("AiChatTask: model was not resolved to ModelConfig");
    }

    // Strict gating: this override doesn't call super.executeStream, so we
    // must gate here to match the contract AiTask.execute and
    // StreamingAiTask.executeStream both enforce.
    this.gateOrThrow(model);

    const connector = resolveHumanConnector(context);

    // Build initial history.
    const history: ChatMessage[] = [];
    const addendum = buildResponseFormatAddendum(input.responseFormat);
    const composedSystemPrompt = [input.systemPrompt ?? "", addendum]
      .filter((s) => s.length > 0)
      .join("\n\n");
    if (composedSystemPrompt.length > 0) {
      history.push({
        role: "system",
        content: [{ type: "text", text: composedSystemPrompt }],
      });
    }
    const firstUserBlocks: ReadonlyArray<ContentBlock> =
      typeof input.prompt === "string"
        ? [{ type: "text", text: input.prompt }]
        : (input.prompt as ReadonlyArray<ContentBlock>);
    history.push({ role: "user", content: firstUserBlocks });

    // Call getJobInput once before the loop to initialize _sessionId.
    const workingInput: AiChatTaskInput = { ...input, messages: history };
    await this.getJobInput(workingInput);
    const strategy = getAiProviderRegistry().getStrategy(model);
    const maxIterations = input.maxIterations ?? 100;

    // Register session disposal so it's cleaned up at end of the resource scope.
    if (context.resourceScope && this._sessionId) {
      const sessionId = this._sessionId;
      context.resourceScope.register(`ai:session:${sessionId}`, async () => {
        await getAiProviderRegistry().disposeSession(model.provider, sessionId);
      });
    }

    // Incremented after each completed assistant turn — emitted via
    // `finish.data.iterations` at the end so the output schema's required
    // `iterations` field is populated. (The streaming accumulator merges
    // `finish.data` over accumulated stream values; no `x-stream`
    // declaration applies to a one-shot scalar like this.)
    let completedTurns = 0;

    // Emit the initial messages as an object-delta. TaskRunner accumulates
    // array object-deltas by appending items (upsert-by-id when an `id`
    // field is present; plain append otherwise). ChatMessage has no id,
    // so we yield *deltas* — just the messages added since the last yield —
    // rather than full snapshots, or the accumulator would duplicate every
    // existing message on each emission.
    yield {
      type: "object-delta",
      port: "messages",
      objectDelta: [...history],
    } as StreamEvent<AiChatTaskOutput>;

    for (let turn = 0; turn < maxIterations; turn++) {
      // Fresh job input per turn with current history snapshot.
      const perTurnInput: AiChatTaskInput = { ...input, messages: [...history] };
      const turnJobInput = await this.getJobInput(perTurnInput);

      let assistantText = "";
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
          } as StreamEvent<AiChatTaskOutput>;
        } else if (event.type === "finish") {
          // swallow — we emit our own finish at the end
        } else {
          yield event as StreamEvent<AiChatTaskOutput>;
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
      } as StreamEvent<AiChatTaskOutput>;

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

      // The elicit schema asks for a plain string; accept either shape so
      // programmatic callers can also send raw ContentBlock[] (e.g. images).
      // `response.done` is a form-completion flag (the submit happened), not
      // a conversation signal — do NOT treat it as end-of-chat. The signal
      // that the user wants to end the conversation is empty content.
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
      } as StreamEvent<AiChatTaskOutput>;
    }

    // `text` and `messages` ride the x-stream merge into the final output.
    // `iterations` has no x-stream, so we deliver it in `finish.data` for
    // the StreamProcessor to merge over the accumulated ports.
    yield {
      type: "finish",
      data: { iterations: completedTurns } as Partial<AiChatTaskOutput>,
    } as StreamEvent<AiChatTaskOutput>;
  }
}
