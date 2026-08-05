/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskStatus } from "@workglow/task-graph";
import React from "react";
import { getStatusColorBg } from "./util";

// A standard header for all node types
export const NodeHeader: React.FC<{
  title: string;
  description: string;
  status: TaskStatus;
}> = ({ title, description, status }) => (
  <>
    <div className="flex items-center mb-2">
      <div className={`w-3 h-3 rounded-full mr-2 ${getStatusColorBg(status)}`}></div>
      <div className="font-semibold truncate">{title}</div>
    </div>
    <div className="text-xs max-h-24 overflow-hidden line-clamp-2">
      {description !== title ? description : null}
    </div>
  </>
);
