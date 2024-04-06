import { TaskOutputRepository } from "ellmers-core/browser";
import { useCallback, useEffect, useState } from "react";

export function RepositoryStatus({ repository }: { repository: TaskOutputRepository }) {
  const [size, setSize] = useState<number>(0);
  const clear = useCallback(() => {
    repository.clear();
    setSize(0);
  }, []);
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
  }, []);

  return (
    <div>
      {repository.constructor.name} {size}
      <button onClick={clear} className="float-right">
        Clear
      </button>
    </div>
  );
}
