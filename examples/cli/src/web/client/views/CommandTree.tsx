/** @jsxImportSource preact */
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSX } from "preact";
import type { WebCommandBadge } from "../../annotations";
import type { WebCommandNode } from "../../commandTree";

/**
 * The one-glyph form of a cost badge.
 *
 * A rail 266px wide has no room for the word, and the point of the badge is
 * that it is visible BEFORE you click into a command — a `db reset` that
 * announces itself only once you are looking at its Run button has announced
 * itself too late.
 */
const BADGE_GLYPH: Readonly<Record<WebCommandBadge, string>> = {
  ai: "AI",
  network: "NET",
  slow: "SLOW",
  writes: "W",
  destructive: "!",
};

export function CommandBadges({
  badges,
  className = "",
}: {
  badges: readonly WebCommandBadge[] | undefined;
  className?: string;
}): JSX.Element | null {
  if (!badges || badges.length === 0) return null;
  return (
    <span className={`badges ${className}`.trim()}>
      {badges.map((badge) => (
        <span key={badge} className={`cb cb-${badge}`} title={badge}>
          {BADGE_GLYPH[badge]}
        </span>
      ))}
    </span>
  );
}

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

  if (node.children.length === 0) {
    const current = selectedPath.join(".") === key;
    return (
      <button className="cmd" aria-current={current} onClick={() => onSelect(node)}>
        <span className="cmd-n">{node.name}</span>
        <span className="cmd-d">{node.description}</span>
        <CommandBadges badges={node.badges} />
      </button>
    );
  }

  // Children live in their own box, indented and ruled down the left, so a leaf
  // that FOLLOWS a collapsed sub-group reads as the sub-group's sibling and not
  // as its child. Depth carried by padding alone could not say which it was.
  const children = isOpen ? (
    <div className="kids">
      {node.children.map((child) => (
        <NodeRow
          key={child.path.join(".")}
          node={child}
          depth={depth + 1}
          open={open}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  ) : null;

  return (
    <>
      {depth === 0 ? (
        <button className="grp-h" onClick={() => onToggle(key)}>
          <span className="caret">{isOpen ? "▾" : "▸"}</span>
          <span>{node.name}</span>
        </button>
      ) : (
        <button className="cmd sub" aria-expanded={isOpen} onClick={() => onToggle(key)}>
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
