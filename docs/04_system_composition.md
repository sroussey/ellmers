# System Composition

Explaination of the parts in the system.

## Storage

We need to store the data somewhere. We need to be able to retrieve it quickly, and we need to be able to update it. We need to be able to store the data in a way that is compatible with the retrieval method.

### Data:

- [ ] In Memory / Code
- [ ] Local file system
- [ ] SQL Databases
  - [ ] SQLite
  - [ ] PostgreSQL
  - [ ] MySQL

### Indexes:

Normally indexes would be part of the storage, but we need to break apart for the use case of an Electron app using SQLite for storage and usearch for the index. Or the indexes could be stored in a separate database as an add-on to some current deployment.

- [ ] In Memory / Code
- [ ] usearch
- [ ] SQL Databases
  - [ ] SQLite
  - [ ] PostgreSQL

## Embeddings

We need to create embeddings for the data. Embeddings are not compatible across models. Models are often speficially trained for a task, and rarely use the same model for embedding and generation like chat.

## Models:

Many models are online, but we also want to be able to test local ones. I don't know if inlining (like I do at the moment) is a good idea. I could convert it to an API call, but it will be fun to test some local models in the browser for funsies. Some local models will require an API at the moment (like llama.cpp) until I build a node module to process directly (is that worth it?) which won't work in the browser anyway, but will work in Electron (needed for the side project that handles my personal data).

- [ ] Use a pre-trained model
  - [ ] Local models
    - [ ] ONNX / Huggingface Transformers
    - [ ] MLC
    - [ ] GGUF / Llama.cpp
  - [ ] Online models
    - [ ] OpenAI
    - [ ] Mistral
    - [ ] Anthropic
    - [ ] Google
    - [ ] Replicate
    - [ ] Huggingface
- [ ] Use a model trained on our data

## Prompts

Prompts coax an LLM to give us back the results that we want. We have different prompts for different purposes.

### Instructions

Instructions introduce a pre-processing step on the text before generating embeddings. They can be used to improve the quality of the embeddings for retrieval, they could be used to create summaries, or to generate keywords, etc.

- [ ] Rewrite the data to make it more useful for retrieval
- [ ] Rewrite the queries for retrieval

### Q&A Prompts

These take results from the retrieval step and add them the context for the query. This prompt will explain the what the data is and that the LLM should answer the query. Would we want to rewrite the query here as well?

## Query Intent

Oh, this is going to be hard. We need to figure out what the user is asking for. We need to be able to do this in a way that is compatible with the retrieval method. Also, what is the context? Is the query one of a series? Were previous retreivals incorrect?

## Retrieval

Based on the query, we want to gather documents to analyze, filter, and rank.

### Vector Similarity Search

The similarity choices can be one of these which might be set based on the tool (like pg-vector) that we use.

- [ ] Inner Product
- [ ] Cosine Similarity
- [ ] Jaccard Similarity
- [ ] Hamming Distance
- [ ] Levenshtein Distance

### Keyword Search

- [ ] In Memory / Code (do we bother?)
- [ ] SQLite FTS
- [ ] PostgreSQL FTS

### Combination Search

- [ ] MeiliSearch
- [ ] ElasticSearch
- [ ] Pinecone

## Filter

We need combine and filter the results. Keep separate from Ranking.

## Ranking

We need combine and rank the results.

## Strategies

OK, now I know why LangChain is called what it is. We have a series of tasks to perform, and they groups of them will be chained together.

### Task

A task is a single step in the chain. It is a single function that takes in data and returns data. It is a single step in the chain. Like sending data to an LLM and getting data back.

- [ ] Name
- [ ] Functionality
- [ ] Parameters
- [ ] Input
- [ ] Output
- [ ] Progress
- [ ] Status
- [ ] Cost
- [ ] Results
- [ ] Errors
- [ ] Logs

### TaskList

A task list is a series of tasks that are chained together.
