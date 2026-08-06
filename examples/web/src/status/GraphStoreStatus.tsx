/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskGraphRepository } from "@workglow/task-graph";
import { useCallback } from "react";

export function GraphStoreStatus({ repository }: { repository: TaskGraphRepository }) {
  const clear = useCallback(() => {
    repository.clear();
  }, [repository]);

  return (
    <div>
      <span>{repository.type}</span>
      <button className="float-right" onClick={clear}>
        Reset
      </button>
    </div>
  );
}
