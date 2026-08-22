/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IHumanConnector, IHumanRequest, IHumanResponse } from "@workglow/util";
import type { RunEventSink } from "./runEventChannel";

/**
 * Asks the human by writing the request to the run's event stream and waiting
 * for a matching line on stdin. The parent bridges both ends to a browser.
 *
 * An aborted run resolves as `cancel` rather than rejecting: a child blocked on
 * a question nobody is reading any more has to end, and a rejection here would
 * surface as a task failure rather than as the cancellation it is.
 */
export class RunEventHumanConnector implements IHumanConnector {
  private readonly pending = new Map<string, (response: IHumanResponse) => void>();

  constructor(private readonly sink: RunEventSink) {}

  send(request: IHumanRequest, signal: AbortSignal): Promise<IHumanResponse> {
    return new Promise<IHumanResponse>((resolve) => {
      const settle = (response: IHumanResponse): void => {
        this.pending.delete(request.requestId);
        resolve(response);
      };
      this.pending.set(request.requestId, settle);
      signal.addEventListener(
        "abort",
        () =>
          settle({
            requestId: request.requestId,
            action: "cancel",
            content: undefined,
            done: true,
          }),
        { once: true }
      );
      this.sink.emit({
        k: "human_request",
        requestId: request.requestId,
        kind: request.kind,
        message: request.message,
        schema: request.contentSchema,
        data: request.contentData,
      });
    });
  }

  async followUp(
    request: IHumanRequest,
    _previous: IHumanResponse,
    signal: AbortSignal
  ): Promise<IHumanResponse> {
    return this.send(request, signal);
  }

  /** One NDJSON line from the parent, shaped like an {@link IHumanResponse}. */
  feedHumanResponseLine(line: string): void {
    let parsed: IHumanResponse;
    try {
      parsed = JSON.parse(line) as IHumanResponse;
    } catch {
      return;
    }
    if (typeof parsed?.requestId !== "string") return;
    this.pending.get(parsed.requestId)?.({ ...parsed, done: parsed.done ?? true });
  }
}
