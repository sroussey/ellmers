# @workglow/browser-control

Browser-control tasks for Workglow (Playwright, Electron, CDP, BunWebView backends).

## Features

- Tasks for browser automation and control
- Supports Playwright, Electron, CDP, and BunWebView backends
- Useful for web scraping, testing, and UI automation within Workglow

## Installation

```bash
npm install @workglow/browser-control
# or
bun add @workglow/browser-control
# or
yarn add @workglow/browser-control
```

## Usage

```typescript
import { BrowserNavigateTask } from "@workglow/browser-control/task";

const task = new BrowserNavigateTask({
  url: "https://example.com"
});

await task.run();
```

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
