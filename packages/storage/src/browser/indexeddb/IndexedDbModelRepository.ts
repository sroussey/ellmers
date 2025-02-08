import {
  ModelPrimaryKey,
  ModelRepository,
  Task2ModelDetail,
  Task2ModelPrimaryKey,
} from "ellmers-ai";
import { IndexedDbKVRepository } from "./base/IndexedDbKVRepository";
import {
  ModelPrimaryKeySchema,
  Task2ModelPrimaryKeySchema,
  Task2ModelDetailSchema,
} from "ellmers-ai";
import { DefaultValueType } from "ellmers-core";

/**
 * IndexedDB implementation of a model repository.
 * Provides storage and retrieval for models and task-to-model mappings.
 */
export class IndexedDbModelRepository extends ModelRepository {
  modelKvRepository: IndexedDbKVRepository<
    ModelPrimaryKey,
    DefaultValueType,
    typeof ModelPrimaryKeySchema
  >;
  task2ModelKvRepository: IndexedDbKVRepository<
    Task2ModelPrimaryKey,
    Task2ModelDetail,
    typeof Task2ModelPrimaryKeySchema,
    typeof Task2ModelDetailSchema
  >;
  public type = "IndexedDbModelRepository" as const;

  constructor(tableModels: string = "models", tableTask2Models: string = "task2models") {
    super();
    this.modelKvRepository = new IndexedDbKVRepository<
      ModelPrimaryKey,
      DefaultValueType,
      typeof ModelPrimaryKeySchema
    >(tableModels, ModelPrimaryKeySchema);
    this.task2ModelKvRepository = new IndexedDbKVRepository<
      Task2ModelPrimaryKey,
      Task2ModelDetail,
      typeof Task2ModelPrimaryKeySchema,
      typeof Task2ModelDetailSchema
    >("task2models", Task2ModelPrimaryKeySchema, Task2ModelDetailSchema, ["model"]);
  }
}
