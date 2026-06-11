-- 0001_kb_chunks_pgvector.sql
create extension if not exists vector;

create table if not exists kb_chunks_768 (
  chunk_id   text not null,
  doc_id     text not null,
  kb_id      text not null,
  tenant_id  text not null,
  project_id text not null,
  vector     vector(768) not null,
  metadata   jsonb not null default '{}'::jsonb,
  primary key (chunk_id, kb_id, tenant_id, project_id)
);

create index if not exists kb_chunks_768_scope_idx
  on kb_chunks_768 (tenant_id, project_id, kb_id);
create index if not exists kb_chunks_768_doc_idx
  on kb_chunks_768 (tenant_id, project_id, kb_id, doc_id);
create index if not exists kb_chunks_768_hnsw_idx
  on kb_chunks_768 using hnsw (vector vector_cosine_ops);

create or replace function match_kb_chunks_768(
  query_embedding vector(768),
  match_count int,
  score_threshold float,
  p_tenant_id text,
  p_project_id text,
  p_kb_id text,
  p_filter jsonb
)
returns table (
  chunk_id text, doc_id text, kb_id text, tenant_id text, project_id text,
  vector vector(768), metadata jsonb, score float
)
language sql stable
as $$
  select c.chunk_id, c.doc_id, c.kb_id, c.tenant_id, c.project_id,
         c.vector, c.metadata,
         (1 - (c.vector <=> query_embedding)) as score
  from kb_chunks_768 c
  where c.tenant_id = p_tenant_id
    and c.project_id = p_project_id
    and c.kb_id = p_kb_id
    and c.metadata @> p_filter
    and (score_threshold is null or (1 - (c.vector <=> query_embedding)) >= score_threshold)
  order by c.vector <=> query_embedding
  limit match_count
$$;

alter table kb_chunks_768 enable row level security;
-- Defense-in-depth: the service role bypasses RLS; this policy gates any
-- non-service connection that might reach the table directly.
create policy kb_chunks_768_tenant_isolation on kb_chunks_768
  using (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'sub');
