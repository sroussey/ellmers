/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { JsonTree } from "./JsonTree";

type JsonObjectProps = {
  data: Record<string, unknown>;
  expandLevel?: number;
};

/**
 * Component for displaying JSON objects with collapsible sections
 */
export const JsonObject: React.FC<JsonObjectProps> = ({ data, expandLevel = 1 }) => {
  const [manualExpanded, setManualExpanded] = useState<boolean | undefined>(undefined);
  const [lastExpandLevel, setLastExpandLevel] = useState(expandLevel);
  if (lastExpandLevel !== expandLevel) {
    setLastExpandLevel(expandLevel);
    setManualExpanded(undefined);
  }
  const isExpanded = manualExpanded ?? expandLevel > 0;

  const toggleExpand = () => {
    setManualExpanded(!isExpanded);
  };

  if (!data || typeof data !== "object" || data === null) {
    return null;
  }

  const keys = Object.keys(data);
  const keyCount = keys.length;

  return (
    <div className="json-object">
      <button type="button" className="json-toggle" onClick={toggleExpand}>
        <span className={`json-toggle-icon ${isExpanded ? "expanded" : "collapsed"}`}>▼</span>
        <span className="json-preview">
          {"{"}
          {!isExpanded && keyCount > 0 && ` ${keyCount} ${keyCount === 1 ? "key" : "keys"} `}
          {"}"}
        </span>
      </button>

      {isExpanded && (
        <div className="json-object-content">
          {keys.length === 0 ? (
            <div className="json-empty">{"{ }"}</div>
          ) : (
            keys.map((key) => (
              <div key={key} className="json-property">
                <JsonTree
                  data={data[key]}
                  label={key}
                  expandLevel={expandLevel - 1}
                  isRoot={false}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
