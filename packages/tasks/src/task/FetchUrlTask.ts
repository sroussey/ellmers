/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IJobExecuteContext } from "@workglow/job-queue";
import { AbortSignalJobError, Job } from "@workglow/job-queue";
import type {
  IExecuteContext,
  RegisteredQueue,
  StreamEvent,
  TaskConfig,
  TaskEntitlements,
} from "@workglow/task-graph";
import {
  CreateWorkflow,
  Entitlements,
  getJobQueueFactory,
  getTaskQueueRegistry,
  JobTaskFailedError,
  mergeEntitlements,
  Task,
  TaskConfigSchema,
  TaskConfigurationError,
  Workflow,
} from "@workglow/task-graph";
import type { DataPortSchema, FromSchema } from "@workglow/util/schema";
import { safeFetch } from "../util/SafeFetch";
import { classifyUrl, urlResourcePattern } from "../util/UrlClassifier";
import { applyCredentialToHeaders } from "./FetchUrlCredentials";
import {
  createFetchUrlAbortedError,
  createFetchUrlHttpError,
  createFetchUrlJobError,
  FetchUrlErrorCode,
  isFetchUrlJobError,
  isFetchUrlNetworkCause,
  wrapFetchUrlNetworkError,
} from "./FetchUrlJobError";

const inputSchema = {
  type: "object",
  properties: {
    url: {
      type: "string",
      title: "URL",
      description: "The URL to fetch from",
      format: "uri",
    },
    method: {
      enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      title: "Method",
      description: "The HTTP method to use",
      default: "GET",
    },
    headers: {
      type: "object",
      additionalProperties: {
        type: "string",
      },
      title: "Headers",
      description: "The headers to send with the request",
    },
    body: {
      type: "string",
      title: "Body",
      description: "The body of the request",
    },
    response_type: {
      enum: ["stream", "text", "json", "blob", "arraybuffer"],
      title: "Response Type",
      description:
        "What to materialize from the response. 'stream' materializes nothing — the bytes " +
        "reach the 'body' port and the cache; read metadata.contentType to decide. The other " +
        "values additionally populate the matching derived port.",
      default: "stream",
    },
    timeout: {
      type: "number",
      title: "Timeout",
      description: "Request timeout in milliseconds",
    },
    credential_key: {
      type: "string",
      format: "credential",
      title: "Credential Key",
      description:
        "Key to look up in the credential store. The resolved secret is placed on the request according to credential_scheme. Incompatible with the queued path, which would persist the secret.",
      "x-ui-hidden": true,
    },
    credential_scheme: {
      enum: ["bearer", "basic", "header", "none"],
      title: "Credential Scheme",
      description:
        "How the resolved credential is sent. 'bearer' and 'basic' use the Authorization header ('basic' expects an already base64-encoded user:pass); 'header' uses credential_header; 'none' resolves but sends nothing.",
      default: "bearer",
      "x-ui-hidden": true,
    },
    credential_header: {
      type: "string",
      title: "Credential Header",
      description:
        "Header name used when credential_scheme is 'header'. Must be a bare header token (letters, digits, hyphens).",
      default: "Authorization",
      "x-ui-hidden": true,
    },
  },
  required: ["url", "response_type"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    body: {
      title: "Body",
      description:
        "The raw response body as an ordered byte stream. Always present; the cache sink " +
        "and any streaming consumer read this port.",
      "x-stream": "binary",
      format: "binary",
    },
    json: { title: "JSON", description: "The JSON response" },
    text: { type: "string", title: "Text", description: "The text response" },
    blob: { title: "Blob", description: "The blob response" },
    arraybuffer: { title: "ArrayBuffer", description: "The arraybuffer response" },
    metadata: {
      type: "object",
      properties: {
        contentType: { type: "string" },
        headers: { type: "object", additionalProperties: { type: "string" } },
        status: { type: "number" },
        notModified: { type: "boolean" },
      },
      additionalProperties: false,
      title: "Response Metadata",
      description: "HTTP response metadata: content type, headers, status, and 304 state",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type FetchUrlResponseType = "stream" | "text" | "json" | "blob" | "arraybuffer";
export type FetchUrlTaskInput = FromSchema<typeof inputSchema>;
export type FetchUrlTaskOutput = FromSchema<typeof outputSchema>;

/**
 * Strict `Content-Length` parse, fail-closed. `parseInt` accepts trailing
 * garbage ("123abc" -> 123), which would let a malformed header defeat the
 * truncation check this feeds. RFC 9112 §6.3 permits repeated headers to be
 * combined as "v1, v2": equal duplicates are valid, mismatched values are a
 * protocol error. Returns `undefined` when the header is absent (chunked
 * transfer), which skips the size assertion.
 */
export function parseContentLength(header: string | null, url: string): number | undefined {
  if (header === null) return undefined;
  const parts = header.split(",").map((p) => p.trim());
  if (parts.length === 0 || parts.some((p) => !/^\d+$/.test(p))) {
    throw createFetchUrlJobError(
      FetchUrlErrorCode.CONTENT_LENGTH_MISMATCH,
      `Invalid Content-Length header ${JSON.stringify(header)} for ${url}`,
      { url }
    );
  }
  if (new Set(parts).size > 1) {
    throw createFetchUrlJobError(
      FetchUrlErrorCode.CONTENT_LENGTH_MISMATCH,
      `Conflicting Content-Length values ${JSON.stringify(header)} for ${url}`,
      { url }
    );
  }
  const parsed = Number(parts[0]);
  if (parsed > Number.MAX_SAFE_INTEGER) {
    throw createFetchUrlJobError(
      FetchUrlErrorCode.CONTENT_LENGTH_MISMATCH,
      `Content-Length ${parts[0]} exceeds MAX_SAFE_INTEGER for ${url}`,
      { url }
    );
  }
  return parsed;
}

/**
 * Issues the request and yields the body in arrival order, reporting progress
 * against `Content-Length` when the origin states one, and asserting the
 * advertised size at end of stream.
 *
 * There is no wrapper stream: the previous implementation rebuilt a second
 * ReadableStream (and a second Response around it) solely so a byte counter
 * could sit between the socket and `.text()`. The caller owns the loop now, so
 * the count happens here.
 */
async function* streamResponseBody(
  response: Response,
  url: string,
  signal: AbortSignal,
  onProgress: (progress: number) => Promise<void>
): AsyncGenerator<Uint8Array> {
  if (!response.body) {
    throw createFetchUrlJobError(
      FetchUrlErrorCode.NO_RESPONSE_BODY,
      "ReadableStream not supported in this environment.",
      { url }
    );
  }
  const totalBytes = parseContentLength(response.headers.get("content-length"), url);
  let receivedBytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      if (signal.aborted) throw createFetchUrlAbortedError();
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      yield value;
      if (totalBytes) await onProgress((receivedBytes / totalBytes) * 100);
    }
  } finally {
    // Cancelling an already-errored source rejects; the consumer has the
    // failure either way, so an unhandled rejection here would only crash
    // the process.
    void reader.cancel().catch(() => {});
  }
  if (totalBytes !== undefined && receivedBytes !== totalBytes) {
    throw createFetchUrlJobError(
      FetchUrlErrorCode.CONTENT_LENGTH_MISMATCH,
      `Content-Length mismatch for ${url}: advertised ${totalBytes} bytes, received ${receivedBytes}`,
      { url }
    );
  }
}

interface FetchUrlMetadata {
  readonly contentType: string;
  readonly headers: Record<string, string>;
  readonly status: number;
  readonly notModified: boolean;
}

function buildMetadata(response: Response): FetchUrlMetadata {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    contentType: response.headers.get("content-type") ?? "",
    headers,
    status: response.status,
    notModified: response.status === 304,
  };
}

function buildHttpError(url: string, response: Response): Error {
  let retryDate: Date | undefined;
  if (response.status === 429 || response.status === 503 || response.headers.get("Retry-After")) {
    const retryAfterStr = response.headers.get("Retry-After");
    if (retryAfterStr) {
      const seconds = Number(retryAfterStr);
      if (Number.isFinite(seconds) && seconds > 0) {
        retryDate = new Date(Date.now() + seconds * 1000);
      } else {
        const parsedDate = new Date(retryAfterStr);
        if (!isNaN(parsedDate.getTime()) && parsedDate > new Date()) retryDate = parsedDate;
      }
    }
  }
  return createFetchUrlHttpError(url, response.status, response.statusText, retryDate);
}

/**
 * Builds the derived port `response_type` named from the collected bytes.
 * `Response.text()` is an unconditional UTF-8 decode per the Fetch standard —
 * it ignores the Content-Type charset — so decoding here is byte-identical to
 * what the previous `.text()` / `.json()` calls produced.
 */
function materializeDerivedPort(
  responseType: string | undefined,
  chunks: readonly Uint8Array[],
  metadata: FetchUrlMetadata
): Record<string, unknown> {
  if (responseType === "stream" || responseType === undefined) return {};
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  if (responseType === "blob") return { blob: new Blob([merged], { type: metadata.contentType }) };
  if (responseType === "arraybuffer") return { arraybuffer: merged.buffer };
  const text = new TextDecoder("utf-8").decode(merged);
  if (responseType === "text") return { text };
  return { json: JSON.parse(text) };
}

export class FetchUrlJob<
  Input extends FetchUrlTaskInput = FetchUrlTaskInput,
  Output = FetchUrlTaskOutput,
> extends Job<Input, Output> {
  static readonly type: string = "FetchUrlJob";

  protected async issueRequest(input: Input, context: IJobExecuteContext): Promise<Response> {
    const classification = classifyUrl(input.url!);
    if (classification.kind === "invalid") {
      throw createFetchUrlJobError(
        FetchUrlErrorCode.INVALID_URL,
        `Refusing to fetch invalid URL ${input.url}: ${classification.reason ?? "malformed"}`,
        { url: input.url }
      );
    }

    // allowPrivate is set to true only when the URL is classified as private:
    // the graph runner (when enforceEntitlements: true) already verified the
    // task was granted `network:private` before reaching this point. When
    // enforceEntitlements is false (default), private URLs are only allowed
    // because the task explicitly declares the network:private entitlement and
    // the caller has opted out of enforcement. safeFetch still re-checks DNS
    // on the server path to defeat DNS rebinding regardless.
    //
    // privateResourceScopes mirrors the task's declared scope from
    // entitlements() below — see urlResourcePattern(input.url) at the task
    // level. Threading it here makes safeFetch re-enforce the same scope on
    // every redirect hop, so a compromised upstream cannot walk across
    // private hosts/ports via Location headers. Least-privilege: the task
    // can only reach the private origin it was specifically authorized for.
    const isPrivate = classification.kind === "private";
    try {
      return await safeFetch(input.url!, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        signal: context.signal,
        allowPrivate: isPrivate,
        privateResourceScopes: isPrivate ? [urlResourcePattern(input.url!)] : undefined,
      });
    } catch (err) {
      if (isFetchUrlJobError(err) || err instanceof AbortSignalJobError) throw err;
      throw wrapFetchUrlNetworkError(input.url!, err);
    }
  }

  /**
   * Streams the response body as `binary-delta` on the `body` port, then a
   * `finish` carrying `metadata` plus whichever derived port `response_type`
   * named. The status is known before the first byte, so a non-2xx throws
   * before any delta is emitted and no downstream consumer is ever dispatched
   * on a doomed fetch.
   */
  async *executeStream(
    input: Input,
    context: IJobExecuteContext
  ): AsyncIterable<StreamEvent<Output>> {
    const response = await this.issueRequest(input, context);
    const metadata = buildMetadata(response);

    if (!response.ok) {
      throw buildHttpError(input.url!, response);
    }

    const chunks: Uint8Array[] = [];
    const wantsValue = input.response_type !== "stream";
    try {
      for await (const chunk of streamResponseBody(
        response,
        input.url!,
        context.signal,
        async (p) => await context.updateProgress(p)
      )) {
        if (wantsValue) chunks.push(chunk);
        const emitted = context.emitStreamEvent?.({
          type: "binary-delta",
          port: "body",
          binaryDelta: chunk,
        });
        if (emitted) await emitted;
        yield { type: "binary-delta", port: "body", binaryDelta: chunk } as StreamEvent<Output>;
      }
    } catch (err) {
      if (isFetchUrlJobError(err) || err instanceof AbortSignalJobError) throw err;
      // A 200 whose body is still on the wire can throw here when the peer
      // resets the socket. That is a network failure, not a decode failure.
      if (isFetchUrlNetworkCause(err)) throw wrapFetchUrlNetworkError(input.url!, err);
      throw err;
    }

    let data: Record<string, unknown>;
    try {
      data = { ...materializeDerivedPort(input.response_type, chunks, metadata), metadata };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw createFetchUrlJobError(
        FetchUrlErrorCode.RESPONSE_PARSE_ERROR,
        `Failed to parse ${input.response_type} response from ${input.url}: ${detail}`,
        { url: input.url }
      );
    }

    yield { type: "finish", data } as StreamEvent<Output>;
  }

  override async execute(input: Input, context: IJobExecuteContext): Promise<Output> {
    let out: Record<string, unknown> = {};
    for await (const event of this.executeStream(input, context)) {
      if (event.type === "finish") out = event.data as Record<string, unknown>;
    }
    return out as Output;
  }
}

const fetchUrlTaskConfigSchema = {
  type: "object",
  properties: {
    ...TaskConfigSchema["properties"],
    queue: {
      oneOf: [{ type: "boolean" }, { type: "string" }],
      description: "Queue handling: false=run inline, true=use default, string=explicit queue name",
      "x-ui-hidden": true,
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type FetchUrlTaskConfig = TaskConfig & {
  queue?: boolean | string;
};

export class FetchUrlTask<
  Input extends FetchUrlTaskInput = FetchUrlTaskInput,
  Output extends FetchUrlTaskOutput = FetchUrlTaskOutput,
  Config extends FetchUrlTaskConfig = FetchUrlTaskConfig,
> extends Task<Input, Output, Config> {
  public static override type = "FetchUrlTask";
  public static override category = "Input";
  public static override title = "Fetch";
  public static override description =
    "Fetches data from a URL with progress tracking and automatic retry handling";
  public static override hasDynamicSchemas: boolean = true;
  public static override hasDynamicEntitlements: boolean = true;

  public static override entitlements(): TaskEntitlements {
    return {
      entitlements: [
        { id: Entitlements.NETWORK_HTTP, reason: "Fetches data from URLs via HTTP/HTTPS" },
        {
          id: Entitlements.CREDENTIAL,
          reason: "May use Bearer token authentication",
          optional: true,
        },
      ],
    };
  }

  /**
   * Dynamic entitlement check: when the configured URL targets a private or
   * loopback host the task additionally requires `network:private`, scoped
   * via the URL's origin so grants can be resource-limited (e.g. a dev-mode
   * grant for `http://localhost:*`). The graph runner evaluates this before
   * `execute()` runs, so a denied private URL never issues a network call.
   *
   * Root-task input may not yet be applied when entitlements are evaluated.
   * If the URL is not available at this point, fail closed and require the
   * private-network entitlement rather than under-declaring it.
   */
  public override entitlements(): TaskEntitlements {
    const base = FetchUrlTask.entitlements();
    const url = this.runInputData?.url;
    if (typeof url !== "string" || url.length === 0) {
      return mergeEntitlements(base, {
        entitlements: [
          {
            id: Entitlements.NETWORK_PRIVATE,
            reason:
              "Runtime URL is not yet available during entitlement evaluation; private/internal destinations must be explicitly allowed",
          },
        ],
      });
    }
    const classification = classifyUrl(url);
    if (classification.kind !== "private") {
      return base;
    }
    return mergeEntitlements(base, {
      entitlements: [
        {
          id: Entitlements.NETWORK_PRIVATE,
          reason: `URL targets private/internal host: ${classification.reason ?? classification.host ?? "unknown"}`,
          resources: [urlResourcePattern(url)],
        },
      ],
    });
  }

  public static override configSchema(): DataPortSchema {
    return fetchUrlTaskConfigSchema;
  }

  public static override inputSchema() {
    return inputSchema;
  }

  public static override outputSchema() {
    return outputSchema;
  }

  /**
   * Computes output schema dynamically based on the current response_type.
   * `body` and `metadata` are always present; `response_type` additionally
   * narrows in the matching derived port (json/text/blob/arraybuffer).
   */
  public override outputSchema(): DataPortSchema {
    const responseType =
      this.runInputData?.response_type ?? this.defaults?.response_type ?? "stream";
    const staticSchema = (this.constructor as typeof FetchUrlTask).outputSchema();
    if (typeof staticSchema === "boolean" || !staticSchema.properties) return staticSchema;

    const all = staticSchema.properties as Record<string, any>;
    // `body` and `metadata` are unconditional: `body` is the transport for
    // every response type (and the only streaming port, which is what keeps
    // the unflagged cache-sink path available), `metadata` is how a "stream"
    // caller learns what it fetched.
    const properties: Record<string, any> = { body: all.body, metadata: all.metadata };
    if (responseType !== "stream" && all[responseType]) {
      properties[responseType] = all[responseType];
    }

    return { type: "object", properties, additionalProperties: false } as DataPortSchema;
  }

  /**
   * Executes the fetch task, either directly or via a job queue depending on
   * the `queue` config/input. Credential resolution is handled by the input
   * resolver system — credential_key arrives already resolved to the secret.
   *
   * Invariant: a resolved secret never leaves this method. Job queues persist
   * their payloads durably (SQLite/Postgres/SQS), so the secret is only ever
   * placed on the in-process request headers of the inline path, and the
   * queued path refuses to run at all when a credential is present.
   */
  override async execute(
    input: FetchUrlTaskInput,
    executeContext: IExecuteContext
  ): Promise<Output> {
    const credential = input.credential_key;
    const queuePref = this.config.queue ?? false;

    // Refuse rather than silently downgrading to the inline path: a downgrade
    // would quietly drop the queue's rate limiting, which is the reason the
    // caller asked for a queue in the first place.
    if (credential && queuePref !== false) {
      throw new TaskConfigurationError(
        "FetchUrlTask: credential_key cannot be combined with the queued path (config.queue), " +
          "because queued job payloads are persisted to durable storage. Remove config.queue to " +
          "run inline, or have the queue worker supply the credential itself."
      );
    }

    const jobInput = this.prepareJobInput(input);

    let cleanup: () => void = () => {};

    try {
      if (queuePref === false) {
        const job = new FetchUrlJob<FetchUrlTaskInput, Output>({ input: jobInput });
        cleanup = job.onJobProgress(
          (progress: number, message: string, details: Record<string, any> | null) => {
            executeContext.updateProgress(progress, message, details);
          }
        );
        return await job.execute(jobInput, {
          signal: executeContext.signal,
          updateProgress: executeContext.updateProgress.bind(this),
        });
      }

      const queueName =
        typeof queuePref === "string" ? queuePref : await this.getDefaultQueueName(input);

      if (!queueName) {
        throw new TaskConfigurationError("FetchUrlTask: Unable to determine queue name");
      }

      const registeredQueue = await this.resolveOrCreateQueue(queueName);

      // Bail early to avoid enqueuing work that has already been cancelled.
      if (executeContext.signal.aborted) {
        throw executeContext.signal.reason ?? new AbortSignalJobError("The operation was aborted");
      }

      const handle = await registeredQueue.client.send(jobInput as Input, {
        jobRunId: this.runConfig.runnerId,
        maxAttempts: 10,
      });

      const onAbort = () => {
        handle.abort().catch((err) => {
          console.warn(`Failed to abort queued fetch job`, err);
        });
      };
      executeContext.signal.addEventListener("abort", onAbort);

      cleanup = handle.onProgress(
        (progress: number, message: string | undefined, details: Record<string, any> | null) => {
          executeContext.updateProgress(progress, message, details);
        }
      );

      try {
        if (executeContext.signal.aborted) {
          throw (
            executeContext.signal.reason ?? new AbortSignalJobError("The operation was aborted")
          );
        }
        const output = await handle.waitFor();
        return output as Output;
      } finally {
        executeContext.signal.removeEventListener("abort", onAbort);
      }
    } catch (err: any) {
      throw new JobTaskFailedError(err);
    } finally {
      cleanup();
    }
  }

  override async *executeStream(
    input: FetchUrlTaskInput,
    executeContext: IExecuteContext
  ): AsyncIterable<StreamEvent<Output>> {
    const credential = input.credential_key;
    const queuePref = this.config.queue ?? false;

    // Mirrors execute()'s refusal: queued job payloads are persisted to
    // durable storage, so a credential can never be handed to the queued
    // path. The queued path itself is not yet wired into executeStream (that
    // lands with queued-source support), but this still has to fail closed
    // rather than let a credentialed request run inline as if queuing had
    // been honored.
    if (credential && queuePref !== false) {
      throw new TaskConfigurationError(
        "FetchUrlTask: credential_key cannot be combined with the queued path (config.queue), " +
          "because queued job payloads are persisted to durable storage. Remove config.queue to " +
          "run inline, or have the queue worker supply the credential itself."
      );
    }

    const jobInput = this.prepareJobInput(input);
    const job = new FetchUrlJob<FetchUrlTaskInput, Output>({ input: jobInput });
    try {
      yield* job.executeStream(jobInput, {
        signal: executeContext.signal,
        updateProgress: executeContext.updateProgress.bind(executeContext),
      }) as AsyncIterable<StreamEvent<Output>>;
    } catch (err: any) {
      throw new JobTaskFailedError(err);
    }
  }

  private prepareJobInput(input: FetchUrlTaskInput): FetchUrlTaskInput {
    const credential = input.credential_key;
    const {
      credential_key: _omitCredential,
      credential_scheme: _omitScheme,
      credential_header: _omitHeader,
      ...rest
    } = input;
    const headers = applyCredentialToHeaders({
      headers: input.headers,
      credential,
      scheme: input.credential_scheme,
      headerName: input.credential_header,
    });
    return headers ? { ...rest, headers } : rest;
  }

  private async resolveOrCreateQueue(queueName: string): Promise<RegisteredQueue<Input, Output>> {
    const registry = getTaskQueueRegistry();
    let registeredQueue = registry.getQueue<Input, Output>(queueName);

    if (!registeredQueue) {
      const factory = getJobQueueFactory();
      registeredQueue = await factory({
        queueName,
        jobClass: FetchUrlJob as any,
        config: this.config,
        task: this,
      });

      try {
        registry.registerQueue(registeredQueue);
      } catch (err) {
        if (err instanceof Error && err.message.includes("already exists")) {
          const existing = registry.getQueue<Input, Output>(queueName);
          if (existing) {
            // Another concurrent call won the race. Stop the server we just
            // created (safe no-op if not yet started) and use the winner's queue.
            registeredQueue.server.stop().catch((stopErr) => {
              console.warn("FetchUrlTask: failed to stop raced-out queue server", stopErr);
            });
            registeredQueue = existing;
          }
        } else {
          throw err;
        }
      }
    }

    if (!registeredQueue.server.isRunning()) {
      await registeredQueue.server.start();
    }

    return registeredQueue;
  }

  /**
   * Detects when response_type changes and emits schemaChange so consumers
   * see the dynamic output schema update.
   */
  public override setInput(input: Partial<Input>): void {
    if (!("response_type" in input)) {
      super.setInput(input);
      return;
    }

    const getCurrentResponseType = () => {
      return this.runInputData?.response_type ?? this.defaults?.response_type ?? "stream";
    };

    const previousResponseType = getCurrentResponseType();

    super.setInput(input);

    const newResponseType = getCurrentResponseType();

    if (previousResponseType !== newResponseType) {
      this.emitSchemaChange();
    }
  }

  private async getDefaultQueueName(input: FetchUrlTaskInput): Promise<string | undefined> {
    if (!input.url) {
      return `fetch:${this.type}`;
    }
    try {
      const hostname = new URL(input.url).hostname.toLowerCase();
      const parts = hostname.split(".").filter(Boolean);
      if (parts.length === 0) {
        return `fetch:${this.type}`;
      }
      const domain = parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
      return `fetch:${domain}`;
    } catch {
      return `fetch:${this.type}`;
    }
  }
}

export const fetchUrl = async (
  input: FetchUrlTaskInput,
  config: FetchUrlTaskConfig = {}
): Promise<FetchUrlTaskOutput> => {
  const result = await new FetchUrlTask(config).run(input);
  return result as FetchUrlTaskOutput;
};

declare module "@workglow/task-graph" {
  interface Workflow {
    fetch: CreateWorkflow<FetchUrlTaskInput, FetchUrlTaskOutput, FetchUrlTaskConfig>;
  }
}

Workflow.prototype.fetch = CreateWorkflow(FetchUrlTask);
