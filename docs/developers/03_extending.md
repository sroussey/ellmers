- [Extending the System](#extending-the-system)
  - [Write a new Task](#write-a-new-task)
    - [Tasks must have a `run()` method](#tasks-must-have-a-run-method)
    - [Define Inputs and Outputs](#define-inputs-and-outputs)
    - [Register the Task](#register-the-task)

# Extending the System

This document covers how to write your own tasks. For a more practical guide to getting started, see the [Developer Getting Started](./01_getting_started.md) guide. Reviewing the [Architecture](02_architecture.md) is required reading before attempting to write your own Tasks.

## Write a new Task

To write a new Task, you need to create a new class that extends the `SingleTask` class. We will leave Compound Tasks for a later section.

### Tasks must have a `run()` method

Here we will write an example of a simple Task that prints a message to the console. Below if the starting code for the Task:

```ts
export class SimpleDebugLogTask extends SimpleTask {
  run() {
    console.dir(<something>, { depth: null });
  }
}
```

We ran too far ahead to the main `run()` method. We need to define the inputs and outputs for the Task first.

### Define Inputs and Outputs

The first thing we need to do is define the inputs and outputs for the Task. This is done by defining the `inputs` and `outputs` static properties on the class. These properties are arrays of objects that define the inputs and outputs for the Task. Each object should have an `id`, `name`, and `valueType` property. There are two optional properties: `isArray` and `defaultValue`.

The `id` is a unique identifier for the input or output, the `name` is a human-readable name for the input or output, and the `valueType` is a string that describes the type of the input or output. The `valueType` should be one of the following strings, or a custom string that describes the type of the input or output: `any`, `boolean`, `number`, `text`, `function`, `model`, `vector`, etc.

Here is the code for the `SimpleDebugLogTask` with the inputs defined:

```ts
type SimpleDebugLogTaskInputs = {
  message: any;
};
export class SimpleDebugLogTask extends SimpleTask {
  public static inputs = [
    {
      id: "message",
      name: "Input",
      valueType: "any",
    },
  ] as const;
  declare defaults: Partial<SimpleDebugLogTaskInputs>;
  declare runInputData: SimpleDebugLogTaskInputs;
  run() {
    console.dir(this.runInputData.message, { depth: null });
  }
}

new SimpleDebugLogTask({ input: { message: "hello world" } }).run();
```

Since the code itself can't read the TypeScript types, we need to explain in the static value `inputs`. We still create a type `SimpleDebugLogTaskInputs` to help us since we are writing TypeScript code. We use it to re-type (`declare`) the `defaults` and `runInputData` properties.

`defaults` and `runInputData` need some explanation. When we instantiate a Task, we can pass in an object called `input` which gets saved in `defaults` (and copied to `runInputData`). In the above example, that is all that happens. However, when in a graph, the outputs of other tasks can be passed in as inputs (these are called data flows). The data flows can add to, or override, the data from `defaults` object. The `runInputData` object is the final object that the Task will use when calling `run()`.

Since `defaults` can be 100% of the input data or 0%, we use a TypeScript Partial. Between defaults and data coming from the graph via data flows, `runInputData` will always have all the data. If not, it is a fatal error.

It is common practice to have an output, and in a case like this, we can add an output that is the same as the input.

```ts
type SimpleDebugLogTaskInputs = {
  message: any;
};
type SimpleDebugLogTaskOutputs = {
  output: any;
};
export class SimpleDebugLogTask extends SimpleTask {
  public static sideeffects = true;
  public static inputs = [
    {
      id: "message",
      name: "Input",
      valueType: "any",
    },
  ] as const;
  declare defaults: Partial<SimpleDebugLogTaskInputs>;
  declare runInputData: SimpleDebugLogTaskInputs;
  public static outputs = [
    {
      id: "output",
      name: "Output",
      valueType: "any",
    },
  ] as const;
  declare runOutputData: SimpleDebugLogTaskOutputs;
  run() {
    console.dir(this.runInputData.message, { depth: null });
    this.runOutputData.output = this.runInputData.message;
    return this.runOutputData;
  }
}

new SimpleDebugLogTask({ input: { message: "hello world" } }).run();
```

In the above code, we added an output to the Task. We also added `static sideeffects` flag to tell the system that this Task has side effects. This is important for the system to know if it can cache the output of the Task or not. If a Task has side effects, it should not be cached.

### Register the Task

To register the Task, you need to add it to the `TaskRegistry` class. The `TaskRegistry` class is a singleton that holds all the registered Tasks and has a `registerTask` method that takes a Task class as an argument.

```ts
TaskRegistry.registerTask(SimpleDebugLogTask);
```

To use the Task in TaskGraphBuilder, there are a few steps:

```ts
export const SimpleDebug = (input: DebugLogTaskInput) => {
  return new SimpleDebugTask({ input }).run();
};

declare module "./base/TaskGraphBuilder" {
  interface TaskGraphBuilder {
    SimpleDebug: TaskGraphBuilderHelper<DebugLogTaskInput>;
  }
}

TaskGraphBuilder.prototype.SimpleDebug = TaskGraphBuilderHelper(SimpleDebugTask);
```
