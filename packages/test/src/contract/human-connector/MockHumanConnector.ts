/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  HumanResponseAction,
  IHumanConnector,
  IHumanRequest,
  IHumanResponse,
} from "@workglow/util";

import type { MockResponseEntry, MockResponseScript } from "./types";

export interface MockHumanConnectorOpts {
  /** Default action when no script entry is queued. Defaults to "accept". */
  readonly defaultAction?: HumanResponseAction;
  /** Whether `followUp` is implemented. Defaults to true. */
  readonly supportsFollowUp?: boolean;
}

type DeferredEntry = {
  readonly kind: "deferred";
  readonly resolved: { value: IHumanResponse | undefined };
  readonly settled: { done: boolean };
  readonly waiters: Array<(res: IHumanResponse) => void>;
};

type ImmediateEntry = { readonly kind: "immediate"; readonly entry: MockResponseEntry };

type QueueEntry = ImmediateEntry | DeferredEntry;

class Script implements MockResponseScript {
  private readonly _received: IHumanRequest[] = [];
  private readonly _queue: QueueEntry[] = [];

  get received(): ReadonlyArray<IHumanRequest> {
    return this._received;
  }

  recordReceived(req: IHumanRequest): void {
    this._received.push(req);
  }

  push(entry: MockResponseEntry): void {
    this._queue.push({ kind: "immediate", entry });
  }

  pushDeferred(): { release(response: IHumanResponse): void } {
    const def: DeferredEntry = {
      kind: "deferred",
      resolved: { value: undefined },
      settled: { done: false },
      waiters: [],
    };
    this._queue.push(def);
    return {
      release: (response) => {
        if (def.settled.done) return;
        def.settled.done = true;
        def.resolved.value = response;
        for (const w of def.waiters) w(response);
        def.waiters.length = 0;
      },
    };
  }

  shift(): QueueEntry | undefined {
    return this._queue.shift();
  }

  clear(): void {
    this._received.length = 0;
    this._queue.length = 0;
  }
}

function defaultAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

function awaitDeferred(def: DeferredEntry, signal: AbortSignal): Promise<IHumanResponse> {
  return new Promise<IHumanResponse>((resolve, reject) => {
    if (signal.aborted) {
      reject(defaultAbortError(signal));
      return;
    }
    if (def.settled.done && def.resolved.value !== undefined) {
      resolve(def.resolved.value);
      return;
    }
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(defaultAbortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    def.waiters.push((res) => {
      signal.removeEventListener("abort", onAbort);
      resolve(res);
    });
  });
}

export class MockHumanConnector implements IHumanConnector {
  private readonly defaultAction: HumanResponseAction;
  private readonly _script: Script;
  readonly followUp?: (
    request: IHumanRequest,
    previous: IHumanResponse,
    signal: AbortSignal
  ) => Promise<IHumanResponse>;

  constructor(opts: MockHumanConnectorOpts = {}) {
    this.defaultAction = opts.defaultAction ?? "accept";
    this._script = new Script();
    if (opts.supportsFollowUp ?? true) {
      this.followUp = (request, _previous, signal) => this.send(request, signal);
    }
  }

  get script(): MockResponseScript {
    return this._script;
  }

  async send(request: IHumanRequest, signal: AbortSignal): Promise<IHumanResponse> {
    if (signal.aborted) throw defaultAbortError(signal);
    this._script.recordReceived(request);
    const entry = this._script.shift();
    if (entry === undefined) {
      return {
        requestId: request.requestId,
        action: this.defaultAction,
        content: undefined,
        done: true,
      };
    }
    if (entry.kind === "deferred") {
      const res = await awaitDeferred(entry, signal);
      return { ...res, requestId: request.requestId };
    }
    const resolved =
      typeof entry.entry === "function" ? await entry.entry(request) : entry.entry;
    return { ...resolved, requestId: request.requestId };
  }
}
