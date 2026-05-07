# @workglow/mcp

Model Context Protocol tasks and plumbing for Workglow.

## Features

- Model Context Protocol (MCP) integration for Workglow
- Tasks for interacting with MCP servers
- Utilities for plumbing MCP into task graphs

## Installation

```bash
npm install @workglow/mcp
# or
bun add @workglow/mcp
# or
yarn add @workglow/mcp
```

## Usage

```typescript
import { McpCallToolTask } from "@workglow/mcp/tasks";
import { Workflow } from "@workglow/task-graph";

const workflow = new Workflow();
workflow.add(new McpCallToolTask({
  server: "my-server",
  toolName: "my-tool",
  arguments: { arg1: "value" }
}));

await workflow.run();
```

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
