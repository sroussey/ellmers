/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IHumanConnector, IHumanRequest, IHumanResponse } from "@workglow/util";
import type { RunEventSink } from "./runEventChannel";

/** Opens a reader for answers, returning how to stop it. */
export type AnswerReaderFactory = (onLine: (line: string) => void) => (() => void) | undefined;

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
  /** Live answer reader, held only while at least one request is outstanding. */
  private stopReader: (() => void) | undefined;

  constructor(
    private readonly sink: RunEventSink,
    private readonly openReader?: AnswerReaderFactory
  ) {}

  /**
   * The reader is opened per outstanding request and released with the last one.
   *
   * Kept open for the life of the process it does exactly one thing beyond
   * reading: it holds the event loop, so a child that has finished its work
   * never exits. Nothing observes that on a terminal — the command has already
   * printed — but the web console ends a run on the child's exit, so every
   * command that asked nothing hung there forever while having done its job in
   * a second.
   */
  private acquireReader(): void {
    if (this.stopReader || !this.openReader) return;
    this.stopReader = this.openReader((line) => this.feedHumanResponseLine(line));
  }

  private releaseReader(): void {
    if (this.pending.size > 0) return;
    const stop = this.stopReader;
    this.stopReader = undefined;
    stop?.();
  }

  send(request: IHumanRequest, signal: AbortSignal): Promise<IHumanResponse> {
    // An `abort` listener added to an ALREADY-aborted signal never fires, so
    // asking on one would emit the request and then wait forever for an answer
    // nobody is reading — the exact hang the abort path exists to avoid.
    if (signal.aborted) {
      return Promise.resolve({
        requestId: request.requestId,
        action: "cancel",
        content: undefined,
        done: true,
      });
    }
    return new Promise<IHumanResponse>((resolve) => {
      const settle = (response: IHumanResponse): void => {
        this.pending.delete(request.requestId);
        this.releaseReader();
        resolve(response);
      };
      this.pending.set(request.requestId, settle);
      // Before the request is emitted, so an answer cannot arrive unread.
      this.acquireReader();
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
