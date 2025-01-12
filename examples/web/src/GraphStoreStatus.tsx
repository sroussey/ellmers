import { TaskGraphRepository } from "ellmers-core";
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
