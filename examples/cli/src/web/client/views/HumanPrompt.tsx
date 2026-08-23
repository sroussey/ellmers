/** @jsxImportSource preact */
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSX } from "preact";
import { useState } from "preact/hooks";

interface SchemaLike {
  readonly properties?: Record<string, { type?: string; title?: string; format?: string }>;
  readonly required?: readonly string[];
}

/**
 * A run asking its operator something. The CLI renders this as an Ink form; the
 * console renders the same schema, and the answer travels back down the same
 * channel the request came up.
 */
export function HumanPrompt({
  request,
  onAnswer,
  canAnswer = true,
}: {
  request: { requestId: string; message: string; schema: unknown };
  onAnswer: (action: "accept" | "cancel", content: Record<string, unknown> | undefined) => void;
  /** False while the CLI is not answering; the run cannot receive a reply. */
  canAnswer?: boolean;
}): JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({});
  const schema = (request.schema ?? {}) as SchemaLike;
  const properties = Object.entries(schema.properties ?? {});

  return (
    <div className="wrap">
      <div className="card" style="border-color:var(--accent)">
        <div className="field">
          <div className="fl">
            <b>The run is asking</b>
            <span>{request.message}</span>
          </div>
          <div className="fc">
            {properties.map(([key, property]) => (
              <div key={key} style="margin-bottom:8px">
                <div className="cmd-d">{property.title ?? key}</div>
                <input
                  type={property.format === "password" ? "password" : "text"}
                  value={values[key] ?? ""}
                  onInput={(event) =>
                    setValues({ ...values, [key]: (event.target as HTMLInputElement).value })
                  }
                />
              </div>
            ))}
            <div style="display:flex;gap:8px;margin-top:8px">
              <button
                className="btn primary"
                onClick={() => onAnswer("accept", values)}
                disabled={!canAnswer}
                title={canAnswer ? undefined : "the CLI is not responding"}
              >
                Send
              </button>
              <button
                className="btn"
                onClick={() => onAnswer("cancel", undefined)}
                disabled={!canAnswer}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
