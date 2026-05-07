# @workglow/javascript

Sandboxed JavaScript task with vendored interpreter.

## Features

- Sandboxed JavaScript execution task
- Vendored interpreter for secure execution
- Can be used within Workglow task graphs

## Installation

```bash
npm install @workglow/javascript
# or
bun add @workglow/javascript
# or
yarn add @workglow/javascript
```

## Usage

```typescript
import { JavaScriptTask } from "@workglow/javascript/task";

const task = new JavaScriptTask({
  code: "return input.a + input.b;",
  input: { a: 1, b: 2 }
});

const result = await task.run();
console.log(result); // { result: 3 }
```

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.
