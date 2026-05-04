/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AccessibilityNode,
  AccessibilityTree,
  AriaRole,
  ClickOptions,
  ElementRef,
  SnapshotOptions,
  WaitOptions,
} from "./IBrowserContext";

// ---------------------------------------------------------------------------
// CDP AX node types (CDP response shape)
// ---------------------------------------------------------------------------

interface CDPAXProperty {
  name: string;
  value: {
    type: string;
    value?: unknown;
    relatedNodes?: Array<{ backendDOMNodeId: number }>;
  };
}

interface CDPAXNode {
  nodeId: string;
  role: { type: string; value: string };
  name: { type: string; value: string };
  backendDOMNodeId?: number;
  properties?: CDPAXProperty[];
  childIds?: string[];
  ignored?: boolean;
}

// ---------------------------------------------------------------------------
// Mutable accessibility node (used while building the tree)
// ---------------------------------------------------------------------------

interface MutableAccessibilityNode {
  ref: ElementRef;
  role: AriaRole;
  name: string;
  level?: number;
  checked?: boolean | "mixed";
  disabled?: boolean;
  expanded?: boolean;
  pressed?: boolean | "mixed";
  selected?: boolean;
  value?: string | number;
  children?: MutableAccessibilityNode[];
}

// ---------------------------------------------------------------------------
// Roles to skip during accessibility tree parsing
// ---------------------------------------------------------------------------

const IGNORED_ROLES = new Set(["none", "generic", "ignored", "InlineTextBox"]);

// ---------------------------------------------------------------------------
// Parse CDP AX tree into AccessibilityNode tree
// ---------------------------------------------------------------------------

function parseCDPAXTree(
  nodes: CDPAXNode[],
  refCounter: { count: number },
  refMap: Map<ElementRef, number | null>
): AccessibilityNode {
  const nodeMap = new Map<string, CDPAXNode>();
  let rootNode: CDPAXNode | undefined;

  for (const node of nodes) {
    nodeMap.set(node.nodeId, node);
    // Root: node whose id is not referenced as a child by any other node
    if (!rootNode) {
      rootNode = node;
    }
  }

  // Find actual root: the node not referenced as a child
  const childIds = new Set<string>();
  for (const node of nodes) {
    for (const childId of node.childIds ?? []) {
      childIds.add(childId);
    }
  }
  rootNode = nodes.find((n) => !childIds.has(n.nodeId)) ?? nodes[0];

  function buildNode(cdpNode: CDPAXNode): MutableAccessibilityNode | null {
    const role = cdpNode.role?.value ?? "";

    // Skip ignored/transparent roles
    if (cdpNode.ignored || IGNORED_ROLES.has(role)) {
      return null;
    }

    const ref = `e${++refCounter.count}`;
    // Store backendDOMNodeId (or null if unavailable) for later element resolution
    refMap.set(ref, cdpNode.backendDOMNodeId ?? null);

    const name = typeof cdpNode.name?.value === "string" ? cdpNode.name.value : "";

    const node: MutableAccessibilityNode = {
      ref,
      role: role as AriaRole,
      name,
    };

    // Parse AX properties
    for (const prop of cdpNode.properties ?? []) {
      switch (prop.name) {
        case "level":
          if (typeof prop.value.value === "number") {
            node.level = prop.value.value;
          }
          break;
        case "checked":
          if (prop.value.value === "mixed") {
            node.checked = "mixed";
          } else if (typeof prop.value.value === "boolean") {
            node.checked = prop.value.value;
          }
          break;
        case "disabled":
          node.disabled = prop.value.value === true;
          break;
        case "expanded":
          node.expanded = prop.value.value === true;
          break;
        case "pressed":
          if (prop.value.value === "mixed") {
            node.pressed = "mixed";
          } else if (typeof prop.value.value === "boolean") {
            node.pressed = prop.value.value;
          }
          break;
        case "selected":
          node.selected = prop.value.value === true;
          break;
        case "valuetext":
        case "value":
          if (typeof prop.value.value === "string" || typeof prop.value.value === "number") {
            node.value = prop.value.value;
          }
          break;
      }
    }

    // Recurse into children
    const childNodes: MutableAccessibilityNode[] = [];
    for (const childId of cdpNode.childIds ?? []) {
      const childCdp = nodeMap.get(childId);
      if (childCdp) {
        const child = buildNode(childCdp);
        if (child) childNodes.push(child);
      }
    }
    if (childNodes.length > 0) {
      node.children = childNodes;
    }

    return node;
  }

  if (!rootNode) {
    const ref = `e${++refCounter.count}`;
    refMap.set(ref, null);
    return { ref, role: "document", name: "" };
  }

  const built = buildNode(rootNode);
  if (!built) {
    const ref = `e${++refCounter.count}`;
    refMap.set(ref, null);
    return { ref, role: "document", name: "" };
  }

  return built as AccessibilityNode;
}

// ---------------------------------------------------------------------------
// Build a YAML-like accessibility tree string from the node tree
// ---------------------------------------------------------------------------

function serializeAXTree(node: AccessibilityNode, indent = 0): string {
  const spaces = "  ".repeat(indent);
  let line = `${spaces}- ${node.role}`;
  if (node.name) {
    line += ` "${node.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  if (node.level !== undefined) line += ` [level=${node.level}]`;
  if (node.checked !== undefined) line += ` [checked=${node.checked}]`;
  if (node.disabled) line += ` [disabled=true]`;
  if (node.expanded !== undefined) line += ` [expanded=${node.expanded}]`;
  if (node.pressed !== undefined) line += ` [pressed=${node.pressed}]`;
  if (node.selected) line += ` [selected=true]`;
  if (node.value !== undefined) line += ` [value=${node.value}]`;

  const lines: string[] = [line];
  for (const child of node.children ?? []) {
    lines.push(serializeAXTree(child, indent + 1));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Convert modifier key names to CDP modifier bitmask.
 * Alt=1, Control=2, Meta=4, Shift=8
 */
function buildModifiersMask(
  modifiers?: ReadonlyArray<"Alt" | "Control" | "Meta" | "Shift">
): number {
  if (!modifiers) return 0;
  let mask = 0;
  for (const mod of modifiers) {
    if (mod === "Alt") mask |= 1;
    else if (mod === "Control") mask |= 2;
    else if (mod === "Meta") mask |= 4;
    else if (mod === "Shift") mask |= 8;
  }
  return mask;
}

/** Map Playwright-style key names to CDP key names. */
const KEY_CODE_MAP: Record<string, string> = {
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Space: " ",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
};

/** Convert a key name to a CDP code string (best effort). */
function keyToCode(key: string): string {
  if (key.length === 1) {
    const upper = key.toUpperCase();
    return `Key${upper}`;
  }
  const codeMap: Record<string, string> = {
    Enter: "Enter",
    Tab: "Tab",
    Escape: "Escape",
    Backspace: "Backspace",
    Delete: "Delete",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Space: "Space",
  };
  return codeMap[key] ?? key;
}

// ---------------------------------------------------------------------------
// CDPBrowserBackend — abstract base for backends that use the Chrome DevTools
// Protocol (CDP) for element interaction, accessibility, and DOM queries.
// ---------------------------------------------------------------------------

export abstract class CDPBrowserBackend {
  protected _refMap = new Map<ElementRef, number | null>();
  protected _refCounter = { count: 0 };

  // ---------------------------------------------------------------------------
  // Abstract — subclasses provide these
  // ---------------------------------------------------------------------------

  /** Send a CDP command. Subclasses wire this to their transport. */
  protected abstract cdp(method: string, params?: Record<string, unknown>): Promise<unknown>;

  /** Human-readable backend name for error messages. */
  protected abstract readonly backendName: string;

  /** Evaluate a JavaScript expression in the page and return the result. */
  protected abstract evaluateInPage<T>(script: string): Promise<T>;

  // ---------------------------------------------------------------------------
  // Ref resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve an ElementRef to a backendDOMNodeId. Throws if unknown.
   */
  protected resolveRefToNodeId(ref: ElementRef): number {
    if (!this._refMap.has(ref)) {
      throw new Error(`${this.backendName}: unknown ref "${ref}"`);
    }
    const nodeId = this._refMap.get(ref);
    if (nodeId == null) {
      throw new Error(`${this.backendName}: ref "${ref}" has no associated DOM node`);
    }
    return nodeId;
  }

  /**
   * Get the bounding box of a DOM node by backendDOMNodeId via CDP.
   */
  protected async getBoundingBox(
    backendNodeId: number
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    const result = (await this.cdp("DOM.getBoxModel", { backendNodeId })) as {
      model: { content: number[] };
    };
    const content = result.model.content;
    // content is [x1,y1, x2,y2, x3,y3, x4,y4] (quad)
    const x = content[0];
    const y = content[1];
    const width = content[2] - content[0];
    const height = content[5] - content[1];
    return { x, y, width, height };
  }

  /**
   * Get the root nodeId of the DOM document.
   */
  protected async getDocumentRootNodeId(): Promise<number> {
    const doc = (await this.cdp("DOM.getDocument", { depth: 0 })) as {
      root: { nodeId: number };
    };
    return doc.root.nodeId;
  }

  // ---------------------------------------------------------------------------
  // Accessibility
  // ---------------------------------------------------------------------------

  async snapshot(_options: SnapshotOptions = {}): Promise<AccessibilityTree> {
    // Clear old snapshot refs but keep the monotonic counter to avoid
    // collisions with refs created by querySelector between snapshots.
    this._refMap.clear();

    const result = (await this.cdp("Accessibility.getFullAXTree")) as { nodes: CDPAXNode[] };
    const nodes = result.nodes ?? [];

    const root = parseCDPAXTree(nodes, this._refCounter, this._refMap);
    const yaml = serializeAXTree(root);

    return { root, yaml };
  }

  // ---------------------------------------------------------------------------
  // Element interaction (by ref)
  // ---------------------------------------------------------------------------

  async click(ref: ElementRef, options: ClickOptions = {}): Promise<void> {
    const backendNodeId = this.resolveRefToNodeId(ref);
    const { x, y, width, height } = await this.getBoundingBox(backendNodeId);
    const cx = x + width / 2;
    const cy = y + height / 2;

    const button = options.button ?? "left";
    const clickCount = options.clickCount ?? 1;
    const modifiers = buildModifiersMask(options.modifiers);

    for (let i = 0; i < clickCount; i++) {
      await this.cdp("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: cx,
        y: cy,
        button,
        clickCount: 1,
        modifiers,
      });
      await this.cdp("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: cx,
        y: cy,
        button,
        clickCount: 1,
        modifiers,
      });
    }
  }

  async fill(ref: ElementRef, value: string, _options: WaitOptions = {}): Promise<void> {
    const backendNodeId = this.resolveRefToNodeId(ref);

    // Focus the element
    await this.cdp("DOM.focus", { backendNodeId });

    // Select all existing text and replace with new value
    await this.cdp("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers: 2, // Control
    });
    await this.cdp("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      modifiers: 2,
    });

    // Insert text via CDP
    await this.cdp("Input.insertText", { text: value });
  }

  async selectOption(
    ref: ElementRef,
    values: string | readonly string[],
    _options: WaitOptions = {}
  ): Promise<void> {
    const backendNodeId = this.resolveRefToNodeId(ref);
    const valuesArray = Array.isArray(values) ? values : [values];

    // Use JavaScript to set the value on the select element
    const result = (await this.cdp("DOM.resolveNode", { backendNodeId })) as {
      object: { objectId: string };
    };
    const objectId = result.object.objectId;

    await this.cdp("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function(vals) {
        const opts = Array.from(this.options);
        for (const opt of opts) {
          opt.selected = vals.includes(opt.value);
        }
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`,
      arguments: [{ value: valuesArray }],
    });
  }

  async hover(ref: ElementRef, _options: WaitOptions = {}): Promise<void> {
    const backendNodeId = this.resolveRefToNodeId(ref);
    const { x, y, width, height } = await this.getBoundingBox(backendNodeId);
    const cx = x + width / 2;
    const cy = y + height / 2;

    await this.cdp("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: cx,
      y: cy,
    });
  }

  // ---------------------------------------------------------------------------
  // Semantic interaction
  // ---------------------------------------------------------------------------

  async clickByRole(role: AriaRole, name: string, options: ClickOptions = {}): Promise<void> {
    const result = (await this.cdp("Accessibility.queryAXTree", {
      role,
      name,
    })) as { nodes: CDPAXNode[] };

    const axNode = result.nodes?.[0];
    if (!axNode) {
      throw new Error(`${this.backendName}: no element with role "${role}" and name "${name}"`);
    }

    if (axNode.backendDOMNodeId == null) {
      throw new Error(
        `${this.backendName}: element with role "${role}" and name "${name}" has no DOM node`
      );
    }

    const { x, y, width, height } = await this.getBoundingBox(axNode.backendDOMNodeId);
    const cx = x + width / 2;
    const cy = y + height / 2;

    const button = options.button ?? "left";
    const clickCount = options.clickCount ?? 1;
    const modifiers = buildModifiersMask(options.modifiers);

    for (let i = 0; i < clickCount; i++) {
      await this.cdp("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: cx,
        y: cy,
        button,
        clickCount: 1,
        modifiers,
      });
      await this.cdp("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: cx,
        y: cy,
        button,
        clickCount: 1,
        modifiers,
      });
    }
  }

  async fillByLabel(label: string, value: string, _options: WaitOptions = {}): Promise<void> {
    // Try CDP path first: find the label via AX tree, resolve its associated input,
    // then use CDP DOM.focus + Input.insertText (no JS injection needed).
    const labelResult = (await this.cdp("Accessibility.queryAXTree", {
      role: "label",
      name: label,
    })) as { nodes: CDPAXNode[] };

    if (labelResult.nodes?.[0]?.backendDOMNodeId != null) {
      const labelNodeId = labelResult.nodes[0].backendDOMNodeId;
      const resolveResult = (await this.cdp("DOM.resolveNode", {
        backendNodeId: labelNodeId,
      })) as {
        object: { objectId: string };
      };

      // Find the associated input element via the label's for/htmlFor or as a child
      const inputResult = (await this.cdp("Runtime.callFunctionOn", {
        objectId: resolveResult.object.objectId,
        functionDeclaration: `function() {
          const forAttr = this.htmlFor || this.getAttribute('for');
          if (forAttr) {
            return document.getElementById(forAttr);
          }
          return this.querySelector('input, textarea, select');
        }`,
        returnByValue: false,
      })) as { result: { objectId?: string; subtype?: string } };

      if (inputResult.result.objectId && inputResult.result.subtype !== "null") {
        // Get the backendNodeId for the input element
        const inputNodeResult = (await this.cdp("DOM.requestNode", {
          objectId: inputResult.result.objectId,
        })) as { nodeId: number };

        const describeResult = (await this.cdp("DOM.describeNode", {
          nodeId: inputNodeResult.nodeId,
        })) as { node: { backendNodeId: number } };

        // Focus and fill via CDP — clean, no JS injection
        await this.cdp("DOM.focus", { backendNodeId: describeResult.node.backendNodeId });
        await this.cdp("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "a",
          code: "KeyA",
          modifiers: 2,
        });
        await this.cdp("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "a",
          code: "KeyA",
          modifiers: 2,
        });
        await this.cdp("Input.insertText", { text: value });
        return;
      }
    }

    // JS fallback: find label by text content, resolve its input, set value with events
    const script = `(function() {
      const labels = Array.from(document.querySelectorAll('label'));
      const label = labels.find(l => l.textContent.trim() === ${JSON.stringify(label)});
      if (!label) return false;
      const forAttr = label.htmlFor;
      let input = forAttr ? document.getElementById(forAttr) : label.querySelector('input, textarea, select');
      if (!input) return false;
      input.focus();
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input), 'value'
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(input, ${JSON.stringify(value)});
      } else {
        input.value = ${JSON.stringify(value)};
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`;
    const filled = await this.evaluateInPage<boolean>(script);
    if (!filled) {
      throw new Error(`${this.backendName}: no input found for label "${label}"`);
    }
  }

  // ---------------------------------------------------------------------------
  // Content extraction
  // ---------------------------------------------------------------------------

  async innerHTML(ref: ElementRef): Promise<string> {
    const backendNodeId = this.resolveRefToNodeId(ref);
    const result = (await this.cdp("DOM.getOuterHTML", { backendNodeId })) as {
      outerHTML: string;
    };
    // Strip outer tag to get innerHTML
    const outer = result.outerHTML;
    const startTagEnd = outer.indexOf(">");
    const endTagStart = outer.lastIndexOf("<");
    if (startTagEnd === -1 || endTagStart <= startTagEnd) {
      return outer;
    }
    return outer.slice(startTagEnd + 1, endTagStart);
  }

  async textContent(ref: ElementRef): Promise<string | null> {
    const backendNodeId = this.resolveRefToNodeId(ref);
    const resolveResult = (await this.cdp("DOM.resolveNode", { backendNodeId })) as {
      object: { objectId: string };
    };
    const objectId = resolveResult.object.objectId;
    const result = (await this.cdp("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: "function() { return this.textContent; }",
      returnByValue: true,
    })) as { result: { value: string | null } };
    return result.result.value;
  }

  async attribute(ref: ElementRef, name: string): Promise<string | null> {
    const backendNodeId = this.resolveRefToNodeId(ref);
    const resolveResult = (await this.cdp("DOM.resolveNode", { backendNodeId })) as {
      object: { objectId: string };
    };
    const objectId = resolveResult.object.objectId;
    const result = (await this.cdp("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: "function(attrName) { return this.getAttribute(attrName); }",
      arguments: [{ value: name }],
      returnByValue: true,
    })) as { result: { value: string | null } };
    return result.result.value;
  }

  // ---------------------------------------------------------------------------
  // CSS selectors
  // ---------------------------------------------------------------------------

  async querySelector(selector: string): Promise<ElementRef | null> {
    const rootNodeId = await this.getDocumentRootNodeId();
    const result = (await this.cdp("DOM.querySelector", {
      nodeId: rootNodeId,
      selector,
    })) as { nodeId: number };

    if (!result.nodeId || result.nodeId === 0) return null;

    // Convert nodeId to backendNodeId
    const describeResult = (await this.cdp("DOM.describeNode", { nodeId: result.nodeId })) as {
      node: { backendNodeId: number };
    };

    const ref = `e${++this._refCounter.count}`;
    this._refMap.set(ref, describeResult.node.backendNodeId);
    return ref;
  }

  async querySelectorAll(selector: string): Promise<readonly ElementRef[]> {
    const rootNodeId = await this.getDocumentRootNodeId();
    const result = (await this.cdp("DOM.querySelectorAll", {
      nodeId: rootNodeId,
      selector,
    })) as { nodeIds: number[] };

    const nodeIds = result.nodeIds ?? [];
    const refs: ElementRef[] = [];

    for (const nodeId of nodeIds) {
      const describeResult = (await this.cdp("DOM.describeNode", { nodeId })) as {
        node: { backendNodeId: number };
      };
      const ref = `e${++this._refCounter.count}`;
      this._refMap.set(ref, describeResult.node.backendNodeId);
      refs.push(ref);
    }

    return refs;
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  async pressKey(key: string, _options: WaitOptions = {}): Promise<void> {
    // Map common key names to CDP key event fields
    const keyCode = KEY_CODE_MAP[key] ?? key;
    await this.cdp("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: keyCode,
      code: keyToCode(key),
    });
    await this.cdp("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: keyCode,
      code: keyToCode(key),
    });
  }

  async type(text: string, _options: WaitOptions = {}): Promise<void> {
    await this.cdp("Input.insertText", { text });
  }

  async scroll(x: number, y: number, ref?: ElementRef): Promise<void> {
    if (ref) {
      // Scroll within element via JS
      const backendNodeId = this.resolveRefToNodeId(ref);
      const resolveResult = (await this.cdp("DOM.resolveNode", { backendNodeId })) as {
        object: { objectId: string };
      };
      const objectId = resolveResult.object.objectId;
      await this.cdp("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function(dx, dy) { this.scrollBy(dx, dy); }`,
        arguments: [{ value: x }, { value: y }],
      });
    } else {
      await this.cdp("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: 0,
        y: 0,
        deltaX: x,
        deltaY: y,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // File operations
  // ---------------------------------------------------------------------------

  async uploadFile(ref: ElementRef, paths: string | readonly string[]): Promise<void> {
    const backendNodeId = this.resolveRefToNodeId(ref);
    const files = Array.isArray(paths) ? paths : [paths];

    await this.cdp("DOM.setFileInputFiles", {
      backendNodeId,
      files,
    });
  }
}
