/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskStatus } from "@workglow/task-graph";
import { Handle, Position } from "@xyflow/react";
import React from "react";

// A standard node container with handles
export const NodeContainer: React.FC<{
  children: React.ReactNode;
  status: TaskStatus;
  isConnectable?: boolean;
}> = ({ children, isConnectable, status }) => (
  <div className={`wrapper gradient ${status.toLowerCase()}`}>
    <div className="inner">
      <div className="body">
        <div className={`shadow-md w-full`}>
          <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
          {children}
          <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
        </div>
      </div>
    </div>
  </div>
);
