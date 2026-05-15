/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken } from "../di/ServiceRegistry";
import type { DataPortSchema } from "../json-schema/DataPortSchema";

/**
 * The kind of interaction being requested.
 *
 * - "notify":  One-way message, no response expected. Fire-and-forget.
 * - "display": Present rich content (markdown, data, visualization hints).
 *              Response optional (acknowledgment).
 * - "elicit":  Request structured input via a form schema (MCP elicitation).
 *              Response expected with user-submitted data.
 */
export type HumanInteractionKind = "notify" | "display" | "elicit";

/** User action in response to an interaction (MCP-aligned for "elicit" kind) */
export type HumanResponseAction = "accept" | "decline" | "cancel";

/**
 * A unified request sent to a human via an IHumanConnector.
 *
 * The `kind` field determines the interaction pattern. The `content` schema
 * describes WHAT to render — the UI layer interprets it based on `kind`.
 */
export interface IHumanRequest {
  /** Unique identifier for this request (used to correlate responses) */
  readonly requestId: string;
  /** Target human identifier — "default" for the main user, or a specific user/role ID */
  readonly targetHumanId: string;
  /** What kind of interaction this is */
  readonly kind: HumanInteractionKind;
  /** Explanatory message shown to the human */
  readonly message: string;
  /**
   * Content schema — describes what to render.
   *
   * For "notify":  Describes notification content (may be empty, message suffices).
   * For "display": Describes the data/visualization to present. Properties contain
   *                the actual data to render. Use x-ui-viewer annotations for hints.
   * For "elicit":  Describes the form fields for user input (MCP requestedSchema).
   */
  readonly contentSchema: DataPortSchema;
  /**
   * Concrete data to display (for "notify" and "display" kinds).
   * For "elicit", this is typically empty — the human provides the data.
   */
  readonly contentData: Record<string, unknown> | undefined;
  /** Whether a response is expected. Default: true for "elicit", false for "notify"/"display". */
  readonly expectsResponse: boolean;
  /** Interaction mode: single request-response or multi-turn conversation */
  readonly mode: "single" | "multi-turn";
  /** Arbitrary context data passed through to the connector */
  readonly metadata: Record<string, unknown> | undefined;
}

/**
 * A response from a human, collected by the IHumanConnector.
 * For "notify"/"display" interactions, this may just be an acknowledgment.
 */
export interface IHumanResponse {
  /** Correlates to the IHumanRequest.requestId */
  readonly requestId: string;
  /**
   * The human's action:
   * - "accept": user submitted data or acknowledged
   * - "decline": user explicitly refused
   * - "cancel": user dismissed without choosing
   */
  readonly action: HumanResponseAction;
  /** The human's response data (present when action is "accept" and kind is "elicit") */
  readonly content: Record<string, unknown> | undefined;
  /** Whether the conversation is complete. Always true for "single" mode. */
  readonly done: boolean;
}

/**
 * Interface for reaching a human and sending interactions.
 *
 * Unified schema-driven: the `kind` field in IHumanRequest determines the
 * interaction pattern. The connector renders accordingly — a notification
 * toast, a data visualization, or an input form.
 */
export interface IHumanConnector {
  /**
   * Send an interaction to a human.
   *
   * For "notify" and "display" kinds that don't expect a response, the
   * connector may resolve immediately with action "accept" and no content.
   *
   * For "elicit" kind, blocks until the human submits, declines, or cancels.
   * Must respect the AbortSignal for cancellation.
   */
  send(request: IHumanRequest, signal: AbortSignal): Promise<IHumanResponse>;

  /**
   * Send a follow-up in a multi-turn conversation.
   * Only called when mode is "multi-turn" and the previous response had done=false.
   */
  followUp?(
    request: IHumanRequest,
    previousResponse: IHumanResponse,
    signal: AbortSignal
  ): Promise<IHumanResponse>;
}

/** Service token for resolving the IHumanConnector from ServiceRegistry */
export const HUMAN_CONNECTOR = createServiceToken<IHumanConnector>("HUMAN_CONNECTOR");

/**
 * Resolves the IHumanConnector from the execution context's ServiceRegistry.
 *
 * Throws a plain `Error` (not TaskConfigurationError, to avoid a dependency on
 * @workglow/task-graph). Callers that need a typed error may catch and rewrap.
 */
export function resolveHumanConnector(context: {
  readonly registry: {
    has(token: typeof HUMAN_CONNECTOR): boolean;
    get(token: typeof HUMAN_CONNECTOR): IHumanConnector;
  };
}): IHumanConnector {
  if (!context.registry.has(HUMAN_CONNECTOR)) {
    throw new Error(
      "HUMAN_CONNECTOR not registered. Register one via " +
        "registry.registerInstance(HUMAN_CONNECTOR, connector) before running a human-in-the-loop task."
    );
  }
  return context.registry.get(HUMAN_CONNECTOR);
}
