# Tasks, Task Lists, and Strategies

## Requirements

- We need to have tasks, and some tasks will be chained together as a "strategy" or list of subtasks.
- We need to sometime run tasks in parallel and sometimes in series.
- Tasks can take a long time, so we need to be able to save the state of a task run and resume it later.
- We do NOT need to be able to run tasks in a distributed manner. v1.2 thing
- A task and a task list should have a similar interface.
- We will want to send a task arguments, if it is a task list, some of those args might be for the subtasks.
- We need progress events.
- Authentication and authorization will be supplied to the task by the task runner.
- convert the task list to a listr2 task list
- be able to represent in a UI (graph, tree, whatever).
- Be able to generate the full graph of tasks and subtasks before running them (though runtime may alter them)

## Questions

- How do we handle errors?
- How do we handle logging?
- Do we use an eventbus?
- If we use an eventbus, do we use a global one or a local one?

## Example use cases

This is to flesh out the requirements above a bit more.

### GetEmbeddingTask

This is a task that takes a document and returns an embedding.

Inputs

- content
- model
- model_parameters

Output

- vector

### ApplyPromptTask

Inputs

- content
- prompt

### TextGenerationTask

Inputs

- content
- model
- model_parameters

Output

- text

### TextRewriterTask

Inputs

- content
- model
- parameters
- prompt

Output

- text

Uses:

- ApplyPromptTask
- TextGenerationTask

### TextRewriterTaskList

Inputs

- content
- model
- parameters
- prompt

Output

- text

Uses:

- TextRewriterTask

### TextEmbeddingStrategy

Inputs

- content
- embedding_model []
- rewriter []
  - prompt_model
  - prompt_model_parameters
  - prompt

Output

- vector []

Uses:

- TextRewriterStrategy
- GetEmbeddingTask

Example:

```ts
new TextEmbeddingStrategy({
  content: "This is a test",
  embedding_model: [
    {
      name: "Xenova/distilbert-base-uncased",
      model_parameters: {
        temperature: 0.7,
      },
    },
  ],
  rewriter: [
    {
      prompt_model: "Xenova/gpt2",
      prompt: "Make this more concise",
    },
    {
      prompt_model: "OpenAI/gpt4-turbo",
      prompt: "Make this more concise",
    },
  ],
});
```

## Task

A task is a single step in the chain where most tasks output will be input for the next task.

Tasks get posted to a job queue and are run by a job queue runner.

## TaskList

A strategy is a list of tasks that are chained together to look like a single task.

## Strategy

A strategy is a list of tasks that are chained together to look like a single task. Parts can be run in series or in parallel. It orchestrates variations of the same task.

Strategies get a name and are saved in the database, both as a parent all the variations. The variation names are based on the spefic parameters used rather than the parent name.
