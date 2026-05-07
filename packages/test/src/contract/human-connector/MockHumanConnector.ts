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

class Script implements MockResponseScript {
  private readonly _received: IHumanRequest[] = [];
  private readonly _queue: MockResponseEntry[] = [];

  get received(): ReadonlyArray<IHumanRequest> {
    return this._received;
  }

  recordReceived(req: IHumanRequest): void {
    this._received.push(req);
  }

  push(entry: MockResponseEntry): void {
    this._queue.push(entry);
  }

  pushDeferred(): { release(response: IHumanResponse): void } {
    throw new Error("not yet implemented");
  }

  shift(): MockResponseEntry | undefined {
    return this._queue.shift();
  }

  clear(): void {
    this._received.length = 0;
    this._queue.length = 0;
  }
}

export class MockHumanConnector implements IHumanConnector {
  private readonly defaultAction: HumanResponseAction;
  private readonly _script: Script;

  constructor(opts: MockHumanConnectorOpts = {}) {
    this.defaultAction = opts.defaultAction ?? "accept";
    this._script = new Script();
  }

  get script(): MockResponseScript {
    return this._script;
  }

  async send(request: IHumanRequest, _signal: AbortSignal): Promise<IHumanResponse> {
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
    const resolved = typeof entry === "function" ? await entry(request) : entry;
    // Always echo the actual request's requestId so adapters cannot accidentally
    // route responses to the wrong caller via a stale id.
    return { ...resolved, requestId: request.requestId };
  }
}
