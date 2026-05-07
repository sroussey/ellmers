/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpElicitationConnector } from "@workglow/mcp/tasks";

import { runHumanConnectorConformance } from "../../contract/human-connector/runHumanConnectorConformance";
import { createPairedMcpHarness } from "./mcpHarness";

runHumanConnectorConformance({
  name: "McpElicitationConnector",
  timeout: 10_000,
  factory: async () => {
    const harness = await createPairedMcpHarness();
    return {
      connector: new McpElicitationConnector(harness.server),
      script: harness.script,
      dispose: harness.dispose,
    };
  },
  capabilities: {
    elicit: true,
    notify: true,
    display: true,
    multiTurn: true,
    concurrent: true,
    abortMidElicit: true,
  },
  expectedFailures: [
    // TODO(phase-4): MCP SDK validates accepted `content` against the `requestedSchema` on
    // the server side (McpElicitationConnector → elicitInput). The concurrent isolation test
    // pushes `{ tag: req.requestId }` as content which doesn't satisfy `{ approved: boolean }`
    // (required by the fixture elicit schema), causing a -32602 schema validation error.
    "concurrent.isolation",
    // TODO(phase-4): Same MCP schema-validation issue: the multiTurn suite pushes
    // `{ step: 1 }` / `{ step: 2 }` as accepted content, but the fixture schema requires
    // `{ approved: boolean }`. McpElicitationConnector forwards the schema to elicitInput,
    // the SDK server validates the harness response, and rejects with -32602.
    "multiTurn.followUp",
  ],
});
