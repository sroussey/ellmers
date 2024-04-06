import { TaskGraphRepository } from "ellmers-core/browser";
import { useCallback } from "react";

export function GraphStoreStatus({ repository }: { repository: TaskGraphRepository }) {
  const clear = useCallback(() => {
    repository.clear();
  }, [repository]);

  return (
    <div>
      <span>{repository.constructor.name}</span>
      <button className="float-right" onClick={clear}>
        Reset
      </button>
    </div>
  );
}
