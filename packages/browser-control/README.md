# @workglow/browser-control

Browser-control tasks and `IBrowserContext` abstraction for Workglow. Backend implementations ship as separate provider packages.

## Features

- 26 task classes for browser automation (navigate, click, fill, snapshot, screenshot, etc.) built against `IBrowserContext`
- Abstract `CDPBrowserBackend` base for backends that drive a Chrome DevTools Protocol target
- DI wire-up via `registerBrowserDeps`

## Backends

Install whichever backend(s) you need alongside this package:

- `@workglow/playwright` — Playwright (Node/Bun)
- `@workglow/electron` — native Electron `webContents` (Electron main process)
- `@workglow/bun-webview` — `Bun.WebView` (Bun-only)

## Installation

```bash
bun add @workglow/browser-control @workglow/playwright
```

## Usage

```typescript
import { registerBrowserDeps, BrowserNavigateTask } from "@workglow/browser-control/task";
import { PlaywrightBackend } from "@workglow/playwright";

registerBrowserDeps({
  createContext: () => new PlaywrightBackend(),
  availableBackends: ["local", "cloud"],
  defaultBackend: "local",
  profileStorage: { /* consumer-defined */ },
});

const task = new BrowserNavigateTask({ url: "https://example.com" });
await task.run();
```

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
