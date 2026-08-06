/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TaskOutputRepository } from "@workglow/task-graph";
import { useCallback, useEffect, useState } from "react";

export function OutputRepositoryStatus({
  repository,
  enabled,
  onToggle,
}: {
  repository: TaskOutputRepository;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const [size, setSize] = useState<number>(0);
  const clear = useCallback(() => {
    repository.clear();
    setSize(0);
  }, [repository]);
  useEffect(() => {
    async function listen() {
      setSize(await repository.size());
    }

    repository.on("output_saved", listen);
    repository.on("output_cleared", listen);

    listen();

    return () => {
      repository.off("output_saved", listen);
      repository.off("output_cleared", listen);
    };
  }, [repository]);

  return (
    <div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          cursor: "pointer",
          userSelect: "none",
          marginBottom: "4px",
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ cursor: "pointer", accentColor: "#888", width: "14px", height: "14px" }}
        />
        <span style={{ color: "#999", fontSize: "0.85em" }}>Enable Output Cache</span>
      </label>
      <span title={repository.constructor.name}>Output Cache</span>: {size}
      <button onClick={clear} className="float-right">
        Clear
      </button>
    </div>
  );
}
