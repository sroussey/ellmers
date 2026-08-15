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
import {
  applyCredentialToHeaders,
  credentialHeaderName,
  CredentialSchemes,
  DEFAULT_CREDENTIAL_SCHEME,
} from "./FetchUrlCredentials";
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
      anyOf: [{ type: "null" }, { enum: ["json", "text", "blob", "arraybuffer"] }],
      title: "Response Type",
      description:
        "The forced type of response to return. If null, the response type is inferred from the Content-Type header.",
      default: null,
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
  required: ["url"],
  additionalProperties: false,
} as const satisfies DataPortSchema;

const outputSchema = {
  type: "object",
  properties: {
    json: {
      title: "JSON",
      description: "The JSON response",
    },
    text: {
      type: "string",
      title: "Text",
      description: "The text response",
    },
    blob: {
      title: "Blob",
      description: "The blob response",
    },
    arraybuffer: {
      title: "ArrayBuffer",
      description: "The arraybuffer response",
    },
    metadata: {
      type: "object",
      properties: {
        contentType: { type: "string" },
        headers: { type: "object", additionalProperties: { type: "string" } },
      },
      additionalProperties: false,
      title: "Response Metadata",
      description: "HTTP response metadata including content type and headers",
    },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

export type FetchUrlTaskInput = FromSchema<typeof inputSchema>;
export type FetchUrlTaskOutput = FromSchema<typeof outputSchema>;

async function fetchWithProgress(
  url: string,
  options: RequestInit & {
    allowPrivate?: boolean;
    privateResourceScopes?: readonly string[];
    sensitiveHeaders?: readonly string[];
  } = {},
  onProgress?: (progress: number) => Promise<void>
): Promise<Response> {
  if (!options.signal) {
    throw createFetchUrlJobError(
      FetchUrlErrorCode.CONFIGURATION,
      "An AbortSignal must be provided."
    );
  }

  let response: Response;
  try {
    response = await safeFetch(url, options);
  } catch (err) {
    if (isFetchUrlJobError(err) || err instanceof AbortSignalJobError) {
      throw err;
    }
    throw wrapFetchUrlNetworkError(url, err);
  }
  if (!response.body) {
    throw createFetchUrlJobError(
      FetchUrlErrorCode.NO_RESPONSE_BODY,
      "ReadableStream not supported in this environment.",
      { url }
    );
  }

  const contentLength = response.headers.get("Content-Length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  let receivedBytes = 0;
  const reader = response.body.getReader();

  const stream = new ReadableStream({
    start(controller) {
      async function push() {
        try {
          while (true) {
            if (options.signal?.aborted) {
              controller.error(createFetchUrlAbortedError());
              // Cancelling rejects when the source stream is already errored;
              // the consumer sees the abort through `controller.error` above,
              // so an unhandled rejection here would only crash the process.
              void reader.cancel().catch(() => {});
              return;
            }

            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              break;
            }
            controller.enqueue(value);
            receivedBytes += value.length;
            if (onProgress && totalBytes) {
              await onProgress((receivedBytes / totalBytes) * 100);
            }
          }
        } catch (error) {
          controller.error(error);
        }
      }
      push();
    },
    cancel() {
      void reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export class FetchUrlJob<
  Input extends FetchUrlTaskInput = FetchUrlTaskInput,
  Output = FetchUrlTaskOutput,
> extends Job<Input, Output> {
  static readonly type: string = "FetchUrlJob";

  /**
   * Header names holding a resolved credential, so safeFetch can drop them on a
   * cross-origin redirect. `Authorization` is covered by safeFetch's own
   * strip-set; this exists for `credential_scheme: "header"`, whose header name
   * is caller-chosen and is stripped from the job input before the request is
   * issued — nothing downstream could otherwise know which header is secret.
   *
   * Set by {@link FetchUrlTask} on the inline path only. It is deliberately not
   * a data port: job inputs are persisted durably by the queued path, and this
   * names a credential header. The queued path refuses credentials outright, so
   * there is nothing for it to carry.
   */
  public sensitiveHeaders: readonly string[] | undefined = undefined;

  override async execute(input: Input, context: IJobExecuteContext): Promise<Output> {
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
    let response: Response;
    try {
      response = await fetchWithProgress(
        input.url!,
        {
          method: input.method,
          headers: input.headers,
          body: input.body,
          signal: context.signal,
          allowPrivate: isPrivate,
          privateResourceScopes: isPrivate ? [urlResourcePattern(input.url!)] : undefined,
          sensitiveHeaders: this.sensitiveHeaders,
        },
        async (progress: number) => await context.updateProgress(progress)
      );
    } catch (err) {
      if (isFetchUrlJobError(err) || err instanceof AbortSignalJobError) {
        throw err;
      }
      throw wrapFetchUrlNetworkError(input.url!, err);
    }

    if (response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const metadata = {
        contentType,
        headers: responseHeaders,
      };

      let resolvedResponseType = input.response_type;
      if (!resolvedResponseType) {
        if (contentType.includes("application/json")) {
          resolvedResponseType = "json";
        } else if (contentType.includes("text/")) {
          resolvedResponseType = "text";
        } else if (contentType.includes("application/octet-stream")) {
          resolvedResponseType = "arraybuffer";
        } else if (
          contentType.includes("application/pdf") ||
          contentType.includes("image/") ||
          contentType.includes("application/zip")
        ) {
          resolvedResponseType = "blob";
        } else {
          resolvedResponseType = "json";
        }
      }
      try {
        if (resolvedResponseType === "json") {
          return { json: await response.json(), metadata } as Output;
        } else if (resolvedResponseType === "text") {
          return { text: await response.text(), metadata } as Output;
        } else if (resolvedResponseType === "blob") {
          return { blob: await response.blob(), metadata } as Output;
        } else if (resolvedResponseType === "arraybuffer") {
          return { arraybuffer: await response.arrayBuffer(), metadata } as Output;
        }
        throw createFetchUrlJobError(
          FetchUrlErrorCode.INVALID_RESPONSE_TYPE,
          `Invalid response type: ${resolvedResponseType}`,
          { url: input.url }
        );
      } catch (err) {
        if (isFetchUrlJobError(err) || err instanceof AbortSignalJobError) {
          throw err;
        }
        // A 200 whose body is still on the wire can throw here when the peer
        // resets the socket. That is a network failure, not a decode failure.
        if (isFetchUrlNetworkCause(err)) {
          throw wrapFetchUrlNetworkError(input.url!, err);
        }
        const detail = err instanceof Error ? err.message : String(err);
        throw createFetchUrlJobError(
          FetchUrlErrorCode.RESPONSE_PARSE_ERROR,
          `Failed to parse ${resolvedResponseType} response from ${input.url}: ${detail}`,
          { url: input.url }
        );
      }
    } else {
      let retryDate: Date | undefined;
      if (
        response.status === 429 ||
        response.status === 503 ||
        response.headers.get("Retry-After")
      ) {
        const retryAfterStr = response.headers.get("Retry-After");
        if (retryAfterStr) {
          const seconds = Number(retryAfterStr);
          if (Number.isFinite(seconds) && seconds > 0) {
            retryDate = new Date(Date.now() + seconds * 1000);
          } else {
            const parsedDate = new Date(retryAfterStr);
            if (!isNaN(parsedDate.getTime()) && parsedDate > new Date()) {
              retryDate = parsedDate;
            }
          }
        }
      }

      throw createFetchUrlHttpError(input.url!, response.status, response.statusText, retryDate);
    }
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
   * Computes output schema dynamically based on the current response_type:
   * null → all output types available; specific value → only that output type.
   */
  public override outputSchema(): DataPortSchema {
    const responseType = this.runInputData?.response_type ?? this.defaults?.response_type ?? null;

    if (responseType === null || responseType === undefined) {
      return (this.constructor as typeof FetchUrlTask).outputSchema();
    }

    const staticSchema = (this.constructor as typeof FetchUrlTask).outputSchema();
    if (typeof staticSchema === "boolean") {
      return staticSchema;
    }

    if (!staticSchema.properties) {
      return staticSchema;
    }

    const properties: Record<string, any> = {};
    if (responseType === "json" && staticSchema.properties.json) {
      properties.json = staticSchema.properties.json;
    } else if (responseType === "text" && staticSchema.properties.text) {
      properties.text = staticSchema.properties.text;
    } else if (responseType === "blob" && staticSchema.properties.blob) {
      properties.blob = staticSchema.properties.blob;
    } else if (responseType === "arraybuffer" && staticSchema.properties.arraybuffer) {
      properties.arraybuffer = staticSchema.properties.arraybuffer;
    }

    if (staticSchema.properties.metadata) {
      properties.metadata = staticSchema.properties.metadata;
    }

    if (Object.keys(properties).length === 0) {
      return staticSchema;
    }

    return {
      type: "object",
      properties,
      additionalProperties: false,
    } as const satisfies DataPortSchema;
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

    // Strip the credential ports unconditionally — after input resolution
    // credential_key holds the secret itself, not the reference id, so it must
    // never survive as a data port. The scheme decides where (or whether) the
    // secret is placed; the job only ever sees the resulting headers.
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
    const jobInput: FetchUrlTaskInput = headers ? { ...rest, headers } : rest;

    // The header the credential landed on, so safeFetch can drop it when a
    // redirect crosses origins. Only the `header` scheme needs telling: the
    // others write Authorization, which is always stripped cross-origin.
    const credentialScheme = input.credential_scheme ?? DEFAULT_CREDENTIAL_SCHEME;
    const sensitiveHeaders =
      credential && credentialScheme !== CredentialSchemes.NONE
        ? [credentialHeaderName(credentialScheme, input.credential_header)]
        : undefined;

    let cleanup: () => void = () => {};

    try {
      if (queuePref === false) {
        const job = new FetchUrlJob<FetchUrlTaskInput, Output>({ input: jobInput });
        job.sensitiveHeaders = sensitiveHeaders;
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
      return this.runInputData?.response_type ?? this.defaults?.response_type ?? null;
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
