# Matrix of Operations

No, we are not talking about math. We have a matrix of ideas to test.

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

We need to create embeddings for the data.

### Models:

We need to choose a model to create the embeddings. Many are online, but we also want to be able to test local ones. I don't know if inlining (like I do at the moment) is a good idea. I could convert it to an API call, but it will be fun to test some local models in the browser for funsies. Some local models will require an API at the moment (like llama.cpp) until I build a node module to process directly (is that worth it?) which won't work in the browser anyway, but will work in Electron (needed for the side project that handles my personal data).

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

### Instructions:

Instructions introduce a pre-processing step on the text before generating the embeddings. They can be used to improve the quality of the embeddings, speficially for the retrieval task.

- [ ] Rewrite the data to make it more useful for retrieval
- [ ] Rewrite the questions to make them more useful for retrieval

## Query Intent

Oh, this is going to be hard. We need to figure out what the user is asking for. We need to be able to do this in a way that is compatible with the retrieval method. Also, what is the context? Is the query one of a series? Were previous retreivals incorrect?

## Retrieval

### Vector Similarity Search

We need to retrieve the data quickly so we need to build and uses indexes:

- [ ] In Memory / Code
- [ ] SQLite VSS
- [ ] PostgreSQL pgvector
- [ ] usearch

The similarity choices can be:

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

## Ranking

We need combine and rank the results.

## Prompting

We need to prompt the LLM with the data in a smart manner. Different approaches may get different results for each LLM, and we need to be able to compare them.

## Testing

We need to test a matrix of choices:
(models for embedding) x (instructions) x (LLM models for the instructions) x (retreival similarities) x (rankings) x (promptings) x (LLM models for the Q&A).

This can conservatively look like:
(10) x (10) x (10) x (5) x (10) x (10) x (10) = 5,000,000 tests.

It will not be difficult to get to a billion tests if we aren't careful. And that is independent of the data size. So we need to be able to run these tests quickly and cheaply and cache intermediate results.
