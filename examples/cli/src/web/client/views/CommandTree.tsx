/** @jsxImportSource preact */
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSX } from "preact";
import type { WebCommandNode } from "../../commandTree";

function NodeRow({
  node,
  depth,
  open,
  selectedPath,
  onToggle,
  onSelect,
}: {
  node: WebCommandNode;
  depth: number;
  open: ReadonlySet<string>;
  selectedPath: readonly string[];
  onToggle: (key: string) => void;
  onSelect: (node: WebCommandNode) => void;
}): JSX.Element {
  const key = node.path.join(".");
  const isOpen = open.has(key);
  const padding = 8 + depth * 13;

  if (node.children.length === 0) {
    const current = selectedPath.join(".") === key;
    return (
      <button
        className="cmd"
        style={`padding-left:${padding}px`}
        aria-current={current}
        onClick={() => onSelect(node)}
      >
        <span className="cmd-n">{node.name}</span>
        <span className="cmd-d">{node.description}</span>
      </button>
    );
  }

  const children = isOpen
    ? node.children.map((child) => (
        <NodeRow
          key={child.path.join(".")}
          node={child}
          depth={depth + 1}
          open={open}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))
    : null;

  return (
    <>
      {depth === 0 ? (
        <button
          className="grp-h"
          style={`padding-left:${padding - 2}px`}
          onClick={() => onToggle(key)}
        >
          <span className="caret">{isOpen ? "▾" : "▸"}</span>
          <span>{node.name}</span>
        </button>
      ) : (
        <button
          className="cmd grp"
          style={`padding-left:${padding - 11}px`}
          onClick={() => onToggle(key)}
        >
          <span className="caret">{isOpen ? "▾" : "▸"}</span>
          <span className="cmd-n">{node.name}</span>
          <span className="cmd-d">{node.description}</span>
        </button>
      )}
      {children}
    </>
  );
}

/** The rail: the program's own tree, nested to whatever depth it has. */
export function CommandTree({
  nodes,
  open,
  selectedPath,
  onToggle,
  onSelect,
}: {
  nodes: readonly WebCommandNode[];
  open: ReadonlySet<string>;
  selectedPath: readonly string[];
  onToggle: (key: string) => void;
  onSelect: (node: WebCommandNode) => void;
}): JSX.Element {
  return (
    <nav className="tree">
      {nodes.map((node) => (
        <div className="grp" key={node.path.join(".")}>
          <NodeRow
            node={node}
            depth={0}
            open={open}
            selectedPath={selectedPath}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        </div>
      ))}
    </nav>
  );
}
