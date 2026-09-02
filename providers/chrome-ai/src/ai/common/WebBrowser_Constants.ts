/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export const WEB_BROWSER = "WEB_BROWSER";

export type WebBrowserPipelineTask =
  | "summarizer"
  | "language-detector"
  | "translator"
  | "prompt"
  | "rewriter";

export const WebBrowserPipelineTask = {
  summarizer: "summarizer",
  "language-detector": "language-detector",
  translator: "translator",
  prompt: "prompt",
  rewriter: "rewriter",
} as const satisfies Record<WebBrowserPipelineTask, WebBrowserPipelineTask>;
