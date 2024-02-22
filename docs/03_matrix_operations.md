# Matrix of Operations

No, we are not talking about math. We have a matrix of ideas to test.

## Rewriters

The rewriter uses a genarative language model to rewrite the text. This is the same as a prompt, but we are using it to rewrite the text instead of generate it.

The main two areas to test:

- Different models for the generator rewriter.
- Different instruction prompts for the above. These will likely be paired.

## Data Embeddings

We convert text into embeddings and use that for similarity search.

There are two main areas to test:

- Different pre-processing methods of the text to embed. We will call this a text rewriter.
- Different models for embedding (conversion of text to a vector).

## Query Embeddings

We need to lookup data based on the query.

- We will use the same embedding model as the data embeddings
- Different pre-processing methods of the query to embed. We will call this a query rewriter. This does not need to use the same generative model as the data rewriter, though it likely would.

## Reranking

We need to re-rank the results based on the query.

## Storage and Retrieval

We can start with these options:

- [ ] SQLite VSS
- [ ] PostgreSQL pgvector
- [ ] usearch

## Filtering

We need combine and filter the results.

## Ranking

We need combine and rank the results.

## Prompting

We need to prompt the LLM with the retrieved data in a smart manner. Different approaches may get different results for each LLM, and we need to be able to compare them.

## Testing

We need to test a matrix of choices:
(models for embedding) x (instructions for data and query embedding) x (LLM models for the instructions) x (filtering) x (rankings) x (promptings) x (LLM models for the Q&A).

This can conservatively look like:
(10) x (10) x (10) x (5) x (5) x (10) x (10) = 2,500,000 tests.

It will not be difficult to get to a billion tests if we aren't careful. And that is independent of the data size. So we need to be able to run these tests quickly and cheaply and cache intermediate results.
