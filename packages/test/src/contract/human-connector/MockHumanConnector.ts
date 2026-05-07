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

  get received(): ReadonlyArray<IHumanRequest> {
    return this._received;
  }

  recordReceived(req: IHumanRequest): void {
    this._received.push(req);
  }

  push(_entry: MockResponseEntry): void {
    throw new Error("not yet implemented");
  }

  pushDeferred(): { release(response: IHumanResponse): void } {
    throw new Error("not yet implemented");
  }

  clear(): void {
    this._received.length = 0;
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
    return {
      requestId: request.requestId,
      action: this.defaultAction,
      content: undefined,
      done: true,
    };
  }
}
