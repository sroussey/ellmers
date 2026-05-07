<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Entitlements and Security

## Overview

The Workglow entitlement system provides a declarative, capability-based security
model for task pipelines. Every task declares the permissions it requires --
network access, filesystem operations, code execution, credential usage, AI model
inference, and more -- and an **entitlement enforcer** decides at runtime whether
those permissions are granted. This design enables safe execution of untrusted or
user-constructed pipelines: a browser environment can deny filesystem access, a
sandboxed server can restrict network calls to specific domains, and a desktop
application can grant broad permissions.

The system is built on four principles:

1. **Hierarchical identifiers.** Entitlement IDs use colon-separated namespacing
   (`"network"`, `"network:http"`, `"network:websocket"`). Granting a parent
   implicitly covers all children.
2. **Resource scoping.** Grants can be narrowed to specific resources using glob
   patterns (e.g., `"/tmp/*"` for filesystem reads, `"claude-*"` for AI models).
3. **Static and dynamic declaration.** Tasks declare entitlements both as static
   class methods (for pre-execution analysis) and as instance methods (for
   runtime-dependent permissions).
4. **Graph-level aggregation.** A `TaskGraph` or `Workflow` can compute the union
   of all entitlements required by its tasks, enabling upfront approval before
   execution begins.

The entitlement types are defined in `@workglow/task-graph` in the
`TaskEntitlements.ts` module, with enforcement logic in `EntitlementEnforcer.ts`
and pre-built profiles in `EntitlementProfiles.ts`.

## Hierarchical Entitlement IDs

Entitlement identifiers are plain strings that use colons as namespace
separators. The hierarchy is implicit in the string structure:

```
network
network:http
network:websocket
network:private
```

Granting `"network"` implicitly covers `"network:http"`, `"network:websocket"`,
and `"network:private"`. This is implemented by the `entitlementCovers()`
function:

```ts
function entitlementCovers(granted: EntitlementId, required: EntitlementId): boolean {
  return required === granted || required.startsWith(granted + ":");
}
```

This means a grant of `"network"` matches a requirement of `"network:http"`
because `"network:http".startsWith("network:")` is true. But a grant of
`"network:http"` does _not_ cover a requirement of `"network"` -- children
cannot satisfy parent requirements.

## Well-Known Entitlements

The `Entitlements` object defines the standard entitlement constants. Tasks may
also use custom IDs beyond these.

### Network

| Constant            | ID                    | Description                                  |
| ------------------- | --------------------- | -------------------------------------------- |
| `NETWORK`           | `"network"`           | All network access                           |
| `NETWORK_HTTP`      | `"network:http"`      | HTTP/HTTPS requests                          |
| `NETWORK_WEBSOCKET` | `"network:websocket"` | WebSocket connections                        |
| `NETWORK_PRIVATE`   | `"network:private"`   | Access to private/internal network addresses |

### Filesystem

| Constant           | ID                   | Description           |
| ------------------ | -------------------- | --------------------- |
| `FILESYSTEM`       | `"filesystem"`       | All filesystem access |
| `FILESYSTEM_READ`  | `"filesystem:read"`  | Read-only access      |
| `FILESYSTEM_WRITE` | `"filesystem:write"` | Write access          |

### Code Execution

| Constant            | ID                            | Description               |
| ------------------- | ----------------------------- | ------------------------- |
| `CODE_EXECUTION`    | `"code-execution"`            | All code execution        |
| `CODE_EXECUTION_JS` | `"code-execution:javascript"` | JavaScript code execution |

### Credentials

| Constant     | ID             | Description                    |
| ------------ | -------------- | ------------------------------ |
| `CREDENTIAL` | `"credential"` | Access to the credential store |

### AI

| Constant       | ID               | Description                |
| -------------- | ---------------- | -------------------------- |
| `AI_MODEL`     | `"ai:model"`     | Use of specific AI models  |
| `AI_INFERENCE` | `"ai:inference"` | Running AI model inference |

### MCP (Model Context Protocol)

| Constant            | ID                    | Description             |
| ------------------- | --------------------- | ----------------------- |
| `MCP`               | `"mcp"`               | All MCP operations      |
| `MCP_TOOL_CALL`     | `"mcp:tool-call"`     | Calling MCP tools       |
| `MCP_RESOURCE_READ` | `"mcp:resource-read"` | Reading MCP resources   |
| `MCP_PROMPT_GET`    | `"mcp:prompt-get"`    | Getting MCP prompts     |
| `MCP_STDIO`         | `"mcp:stdio"`         | MCP via stdio transport |

### Storage

| Constant        | ID                | Description            |
| --------------- | ----------------- | ---------------------- |
| `STORAGE`       | `"storage"`       | All storage operations |
| `STORAGE_READ`  | `"storage:read"`  | Reading from storage   |
| `STORAGE_WRITE` | `"storage:write"` | Writing to storage     |

## TaskEntitlement Type

A single entitlement declaration is represented by the `TaskEntitlement`
interface:

```ts
interface TaskEntitlement {
  readonly id: EntitlementId;
  readonly reason?: string;
  readonly optional?: boolean;
  readonly resources?: readonly string[];
}
```

| Field       | Type                    | Description                                                                                                                                |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`        | `string`                | Hierarchical identifier (e.g., `"network:http"`)                                                                                           |
| `reason`    | `string \| undefined`   | Human-readable explanation of why the entitlement is needed                                                                                |
| `optional`  | `boolean \| undefined`  | If `true`, the task can degrade gracefully without this permission                                                                         |
| `resources` | `string[] \| undefined` | Specific resources this entitlement applies to (URL patterns, model IDs, server names). When `undefined`, the entitlement applies broadly. |

Multiple entitlements are grouped in the `TaskEntitlements` container:

```ts
interface TaskEntitlements {
  readonly entitlements: readonly TaskEntitlement[];
}
```

A shared `EMPTY_ENTITLEMENTS` singleton (frozen object with an empty array) is
used to avoid allocations for tasks that require no entitlements.

### Tracked Entitlements

For graph-level analysis, `TrackedTaskEntitlement` extends `TaskEntitlement` with
origin tracking:

```ts
interface TrackedTaskEntitlement extends TaskEntitlement {
  readonly sourceTaskIds: readonly unknown[];
}
```

This allows UIs and policy engines to show _which tasks_ in a graph require each
entitlement, enabling targeted approval or task removal.

## Resource Scoping with Glob Patterns

Entitlement grants support resource-level scoping using glob patterns with any
number of `*` wildcards. Each `*` matches zero or more characters of any kind,
including path separators like `/`. The `resourcePatternMatches()` function
implements pattern matching:

```ts
function resourcePatternMatches(grantPattern: string, requiredResource: string): boolean;
```

Matching rules:

- Without `*`: exact string match only.
- `"prefix*"` matches anything starting with `"prefix"`.
- `"*.example.com"` matches anything ending with `".example.com"`.
- `"pre*suf"` matches strings with the given prefix and suffix, with any content
  in between.
- `"a*b*c"` matches strings containing `"a"`, then `"b"`, then `"c"` in order.
- `"https://localhost:*/*"` matches any URL on localhost with a path segment.

Examples:

| Grant Pattern             | Required Resource              | Match? |
| ------------------------- | ------------------------------ | ------ |
| `"/tmp/*"`                | `"/tmp/data.json"`             | Yes    |
| `"/tmp/*"`                | `"/tmp/sub/file.txt"`          | Yes    |
| `"claude-*"`              | `"claude-3-opus"`              | Yes    |
| `"claude-*"`              | `"gpt-4o"`                     | No     |
| `"*.example.com"`         | `"api.example.com"`            | Yes    |
| `"gpt-4o"`                | `"gpt-4o"`                     | Yes    |
| `"gpt-4o"`                | `"gpt-4o-mini"`                | No     |
| `"https://localhost:*/*"` | `"https://localhost:3000/foo"` | Yes    |
| `"https://localhost:*/*"` | `"https://localhost:3000"`     | No     |
| `"a*b*c"`                 | `"aXXbYYc"`                    | Yes    |

### Grant-to-Requirement Matching

The `grantCoversResources()` function checks whether a grant satisfies the
resource requirements of an entitlement:

```ts
function grantCoversResources(grant: EntitlementGrant, required: TaskEntitlement): boolean;
```

The matching rules are:

1. **Broad grant** (no `resources` on the grant): covers any requirement.
2. **Broad requirement** (no `resources` on the entitlement): only a broad grant
   covers it. A scoped grant cannot satisfy a broad need.
3. **Both have resources**: every required resource must match at least one grant
   pattern.

## Declaring Entitlements

### Static Declaration

Tasks declare their base entitlements by overriding the static `entitlements()`
method on their class:

```ts
class FetchUrlTask extends Task<FetchInput, FetchOutput> {
  static readonly type = "FetchUrlTask";

  public static override entitlements(): TaskEntitlements {
    return {
      entitlements: [
        { id: Entitlements.NETWORK_HTTP, reason: "Fetches data from URLs via HTTP/HTTPS" },
        {
          id: Entitlements.CREDENTIAL,
          reason: "May use Bearer token authentication",
          optional: true,
        },
      ],
    };
  }
}
```

Static entitlements are available without instantiating the task. They are used
for pre-execution analysis, UI display, and graph-level policy checks.

### Instance Declaration (Dynamic Entitlements)

When a task's required permissions depend on its runtime configuration, it
overrides the instance `entitlements()` method and sets the static
`hasDynamicEntitlements` flag:

```ts
class AiTask extends Task<AiInput, AiOutput> {
  public static override hasDynamicEntitlements: boolean = true;

  public static override entitlements(): TaskEntitlements {
    return {
      entitlements: [{ id: Entitlements.AI_INFERENCE, reason: "Runs AI model inference" }],
    };
  }

  public override entitlements(): TaskEntitlements {
    const base: TaskEntitlement[] = [
      { id: Entitlements.AI_INFERENCE, reason: "Runs AI model inference" },
    ];
    const modelId = typeof this.defaults.model === "string" ? this.defaults.model : undefined;
    if (modelId) {
      base.push({
        id: Entitlements.AI_MODEL,
        reason: `Uses model ${modelId}`,
        resources: [modelId],
      });
    }
    return { entitlements: base };
  }
}
```

The `hasDynamicEntitlements` flag signals to the framework that static analysis
alone is insufficient and instance-level entitlements should be checked.

Tasks can notify listeners of entitlement changes by calling
`emitEntitlementChange()`:

```ts
protected emitEntitlementChange(entitlements?: TaskEntitlements): void {
  const final = entitlements ?? this.entitlements();
  this.emit("entitlementChange", final);
}
```

### Examples from Built-In Tasks

**JavaScriptTask** -- requires code execution:

```ts
public static override entitlements(): TaskEntitlements {
  return {
    entitlements: [
      {
        id: Entitlements.CODE_EXECUTION_JS,
        reason: "Executes user-provided JavaScript code in a sandboxed interpreter",
      },
    ],
  };
}
```

**McpToolCallTask** -- static entitlements plus dynamic server scoping:

```ts
// Static: base MCP permissions
public static override entitlements(): TaskEntitlements {
  return {
    entitlements: [
      { id: Entitlements.MCP_TOOL_CALL, reason: "Calls MCP tools" },
    ],
  };
}

// Instance: adds the specific server name as a resource
public override entitlements(): TaskEntitlements {
  const base = McpToolCallTask.entitlements();
  if (this.defaults.serverName) {
    return {
      entitlements: [
        ...base.entitlements,
        { id: Entitlements.MCP, resources: [this.defaults.serverName] },
      ],
    };
  }
  return base;
}
```

## Entitlement Enforcement

### IEntitlementEnforcer

The `IEntitlementEnforcer` interface defines the contract for checking whether
required entitlements are granted:

```ts
interface IEntitlementEnforcer {
  checkAll(required: TaskEntitlements): Promise<readonly EntitlementDenial[]>;
  checkTask(task: ITask): Promise<readonly EntitlementDenial[]>;
}
```

`checkAll()` is the preflight check: it evaluates every required entitlement
against the policy, resolving `"ask"` verdicts via the registered
`IEntitlementResolver`. `checkTask()` is the runtime check for tasks with
`hasDynamicEntitlements`. Both return an array of `EntitlementDenial` records
(non-optional entitlements only) — an empty array means all entitlements are
granted.

Each `EntitlementDenial` is a discriminated union on `reason`:

- `"policy-deny"` -- matched an explicit deny rule (`matchedRule` present)
- `"user-deny"` -- matched an ask rule and the resolver returned `"deny"` (`matchedRule` present)
- `"default-deny"` -- no rule covered the entitlement (`matchedRule` absent)

Use `formatEntitlementDenial(denial)` to render a human-readable message.

### Built-In Enforcers

**Permissive enforcer** -- grants everything, suitable for trusted environments:

```ts
const PERMISSIVE_ENFORCER: IEntitlementEnforcer = {
  checkAll: async () => [],
  checkTask: async () => [],
};
```

**Grant-list enforcer** -- checks against a list of entitlement ID strings
(broad grants only):

```ts
const enforcer = createGrantListEnforcer(["network", "ai", "storage"]);
```

**Scoped enforcer** -- supports resource-level matching with glob patterns:

```ts
const enforcer = createScopedEnforcer([
  { id: "network:http" },
  { id: "filesystem:read", resources: ["/tmp/*"] },
  { id: "ai:model", resources: ["claude-*", "gpt-4o"] },
  { id: "code-execution" },
]);
```

The scoped enforcer iterates each required entitlement, finds grants whose IDs
cover it (using `entitlementCovers()` for hierarchy), and then verifies resource
coverage (using `grantCoversResources()`). Optional entitlements are never
denied.

### Entitlement Profiles

Pre-built profiles provide grant sets for common runtime environments:

```ts
type EntitlementProfile = "browser" | "desktop" | "server";
```

**Browser profile** -- no filesystem, no code execution, no stdio MCP:

```ts
const BROWSER_GRANTS: readonly EntitlementGrant[] = [
  { id: "network" },
  { id: "ai" },
  { id: "mcp:tool-call" },
  { id: "mcp:resource-read" },
  { id: "mcp:prompt-get" },
  { id: "storage" },
  { id: "credential" },
];
```

**Desktop profile** -- adds filesystem, code execution, and stdio MCP:

```ts
const DESKTOP_GRANTS: readonly EntitlementGrant[] = [
  ...BROWSER_GRANTS,
  { id: "filesystem" },
  { id: "code-execution" },
  { id: "mcp:stdio" },
];
```

**Server profile** -- same as desktop (can be further scoped):

```ts
const SERVER_GRANTS: readonly EntitlementGrant[] = [...DESKTOP_GRANTS];
```

Create an enforcer for a profile with:

```ts
const enforcer = createProfileEnforcer("browser");
```

### Registering an Enforcer

The enforcer is registered in the `ServiceRegistry` under the
`ENTITLEMENT_ENFORCER` service token:

```ts
import { globalServiceRegistry } from "@workglow/util";
import { ENTITLEMENT_ENFORCER, createProfileEnforcer } from "@workglow/task-graph";

globalServiceRegistry.registerInstance(ENTITLEMENT_ENFORCER, createProfileEnforcer("browser"));
```

## IEntitlementProfile

`createProfileEnforcer` returns an `IEntitlementProfile`, a richer surface
than the bare `IEntitlementEnforcer`:

```ts
interface IEntitlementProfile extends IEntitlementEnforcer {
  readonly name: string;
  surface(): readonly EntitlementGrant[];
  requestEntitlement(required: TaskEntitlement): Promise<EntitlementRequestResult>;
  subscribe(listener: (event: EntitlementChangeEvent) => void): () => void;
  dispose(): Promise<void>;
}

type EntitlementRequestResult =
  | { readonly outcome: "granted"; readonly entitlement: TaskEntitlement }
  | { readonly outcome: "denied"; readonly denial: EntitlementDenial };

type EntitlementChangeEvent = {
  readonly kind: "revoked" | "granted";
  readonly entitlement: TaskEntitlement;
};
```

- `surface()` returns the maximum set of grants the profile may issue.
- `requestEntitlement(e)` is the single-key form of `checkAll`. Optional
  entitlements always map to `{ outcome: "granted" }`. `"ask"` policy
  verdicts are resolved internally before returning.
- `subscribe(listener)` returns events when previously-observed
  entitlements transition between granted and denied. Built-in profiles
  with the default `STATIC_SIGNAL_SOURCE` never emit. Downstream profiles
  plug in a platform signal source (Electron permission events,
  browser Permissions API onchange, etc.).
- `dispose()` is idempotent and unsubscribes from the signal source.

### Pluggable signal source

```ts
interface IEntitlementSignalSource {
  subscribe(listener: (signal: EntitlementSignal) => void): () => void;
}

type EntitlementSignal =
  | { readonly kind: "revoke"; readonly entitlement: TaskEntitlement }
  | { readonly kind: "grant"; readonly entitlement: TaskEntitlement }
  | { readonly kind: "reload" };
```

Pass a custom source to `createProfileEnforcer`:

```ts
const profile = createProfileEnforcer("desktop", {
  signalSource: myElectronPermissionsSource,
});
```

The default is `STATIC_SIGNAL_SOURCE` (no-op). On `revoke`/`grant`, the
profile re-evaluates the targeted entitlement and emits a change event
only if the verdict actually flipped. On `reload`, the profile
re-evaluates every entitlement it has previously been queried about.

### ENTITLEMENT_PROFILE service token

A separate service token registers profiles in the global registry.
It coexists with `ENTITLEMENT_ENFORCER`; consumers that only need the
basic enforcer surface can register the profile under that token too,
since `IEntitlementProfile extends IEntitlementEnforcer`.

```ts
import { globalServiceRegistry } from "@workglow/util";
import { ENTITLEMENT_PROFILE, createProfileEnforcer } from "@workglow/task-graph";

globalServiceRegistry.registerInstance(ENTITLEMENT_PROFILE, createProfileEnforcer("browser"));
```

## Graph-Level Entitlement Analysis

The `computeGraphEntitlements()` function aggregates entitlements across all
tasks in a `TaskGraph`:

```ts
function computeGraphEntitlements(
  graph: TaskGraph,
  options?: GraphEntitlementOptions
): TaskEntitlements;
```

Options:

| Option                | Type                | Default | Description                                    |
| --------------------- | ------------------- | ------- | ---------------------------------------------- |
| `trackOrigins`        | `boolean`           | `false` | Annotate each entitlement with source task IDs |
| `conditionalBranches` | `"all" \| "active"` | `"all"` | Which conditional branches to include          |

When `conditionalBranches` is `"all"` (the default), entitlements from every
branch of a `ConditionalTask` are included -- this is conservative and suitable
for pre-execution approval. When set to `"active"`, only entitlements from
non-disabled branches are included, which is useful for runtime checks after
conditions have been evaluated.

```ts
import {
  computeGraphEntitlements,
  formatEntitlementDenial,
  ENTITLEMENT_ENFORCER,
} from "@workglow/task-graph";
import { globalServiceRegistry } from "@workglow/util";

const enforcer = globalServiceRegistry.get(ENTITLEMENT_ENFORCER);

// Pre-execution: analyze all possible entitlements
const allEntitlements = computeGraphEntitlements(graph, { trackOrigins: true });
for (const e of allEntitlements.entitlements) {
  console.log(`${e.id} required by tasks: ${e.sourceTaskIds.join(", ")}`);
}

// Check against enforcer (requires top-level await or async context)
const denied = await enforcer.checkAll(allEntitlements);
if (denied.length > 0) {
  throw new Error(`Denied entitlements: ${denied.map(formatEntitlementDenial).join(", ")}`);
}
```

## Merging Entitlements

The `mergeEntitlements()` function combines two `TaskEntitlements` objects into
their union:

```ts
function mergeEntitlements(a: TaskEntitlements, b: TaskEntitlements): TaskEntitlements;
```

Merge semantics for entitlements with the same ID:

- **`optional`**: `false` wins (most restrictive). If either side says the
  entitlement is mandatory, the merged result is mandatory.
- **`reason`**: first non-empty reason wins.
- **`resources`**: union of all resource arrays.

## Entitlements in JSON Serialization

When a task is serialized via `toJSON()`, its entitlements are included in the
output if non-empty:

```json
{
  "id": "task-1",
  "type": "FetchUrlTask",
  "defaults": { "url": "https://example.com" },
  "entitlements": {
    "entitlements": [
      { "id": "network:http", "reason": "Fetches data from URLs via HTTP/HTTPS" },
      { "id": "credential", "reason": "May use Bearer token authentication", "optional": true }
    ]
  }
}
```

This enables offline policy analysis and UI display of required permissions
without needing to instantiate task classes.

## API Reference

### Types

| Type                      | Description                                                                 |
| ------------------------- | --------------------------------------------------------------------------- |
| `EntitlementId`           | `string` -- hierarchical entitlement identifier                             |
| `TaskEntitlement`         | Single entitlement declaration with `id`, `reason`, `optional`, `resources` |
| `TaskEntitlements`        | Container with `entitlements: readonly TaskEntitlement[]`                   |
| `TrackedTaskEntitlement`  | `TaskEntitlement` plus `sourceTaskIds` for origin tracking                  |
| `TrackedTaskEntitlements` | Container with `entitlements: readonly TrackedTaskEntitlement[]`            |
| `EntitlementGrant`        | Grant declaration with `id` and optional `resources` (glob patterns)        |
| `EntitlementProfile`      | `"browser" \| "desktop" \| "server"`                                        |
| `EntitlementDenial`       | Denied entitlement: `{ entitlement, reason, matchedRule? }` (discriminated) |
| `EntitlementDenialReason` | `"policy-deny" \| "default-deny" \| "user-deny"`                            |
| `IEntitlementEnforcer`    | Interface with async `checkAll(required)` and `checkTask(task)` methods     |
| `IEntitlementProfile`     | Profile interface — extends `IEntitlementEnforcer` with surface, requestEntitlement, subscribe, dispose |
| `EntitlementRequestResult`| Discriminated union returned by `requestEntitlement`                                                    |
| `EntitlementChangeEvent`  | `{ kind: "revoked" \| "granted", entitlement }`                                                          |
| `EntitlementSignal`       | `{ kind: "revoke" \| "grant", entitlement } \| { kind: "reload" }`                                       |
| `IEntitlementSignalSource`| Pluggable port that emits `EntitlementSignal`                                                            |
| `CreateProfileOptions`    | `{ resolver?, signalSource? }`                                                                           |

### Functions

| Function                   | Signature                                                         | Description                                                         |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `entitlementCovers`        | `(granted: string, required: string) => boolean`                  | Check if a granted ID covers a required ID in the hierarchy         |
| `resourcePatternMatches`   | `(grantPattern: string, requiredResource: string) => boolean`     | Check if a glob pattern matches a resource string                   |
| `grantCoversResources`     | `(grant: EntitlementGrant, required: TaskEntitlement) => boolean` | Check if a grant covers the resource requirements of an entitlement |
| `mergeEntitlements`        | `(a: TaskEntitlements, b: TaskEntitlements) => TaskEntitlements`  | Merge two entitlement sets into their union                         |
| `createGrantListEnforcer`  | `(grants: readonly string[]) => IEntitlementEnforcer`             | Create an enforcer from a list of broad grant IDs                   |
| `createScopedEnforcer`     | `(grants: readonly EntitlementGrant[]) => IEntitlementEnforcer`   | Create an enforcer with resource-level scoping                      |
| `createProfileEnforcer`    | `(profile: EntitlementProfile, options?: CreateProfileOptions) => IEntitlementProfile` | Create a profile for a standard runtime configuration |
| `createPolicyProfile`      | `(name: string, policy: EntitlementPolicy, options?: CreateProfileOptions) => IEntitlementProfile` | Create a profile from an arbitrary policy |
| `getProfileGrants`         | `(profile: EntitlementProfile) => readonly EntitlementGrant[]`    | Get the grant list for a profile                                    |
| `computeGraphEntitlements` | `(graph: TaskGraph, options?) => TaskEntitlements`                | Aggregate entitlements across all tasks in a graph                  |
| `formatEntitlementDenial`  | `(denial: EntitlementDenial) => string`                           | Render a denial as a human-readable error-message fragment          |

### Constants

| Constant               | Description                                               |
| ---------------------- | --------------------------------------------------------- |
| `Entitlements`         | Object containing all well-known entitlement ID constants |
| `EMPTY_ENTITLEMENTS`   | Frozen singleton with an empty entitlements array         |
| `PERMISSIVE_ENFORCER`  | Enforcer that grants everything                           |
| `ENTITLEMENT_ENFORCER` | Service token for registering a custom enforcer           |
| `BROWSER_GRANTS`       | Grant array for browser environments                      |
| `DESKTOP_GRANTS`       | Grant array for desktop environments                      |
| `SERVER_GRANTS`        | Grant array for server environments                       |
| `STATIC_SIGNAL_SOURCE` | No-op `IEntitlementSignalSource` (built-in profile default) |
| `ENTITLEMENT_PROFILE`  | Service token for registering an `IEntitlementProfile`      |
