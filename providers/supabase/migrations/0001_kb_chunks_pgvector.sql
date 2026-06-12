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
  using (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'sub')
  with check (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'sub');

create table if not exists kb_chunks_384 (
  chunk_id   text not null,
  doc_id     text not null,
  kb_id      text not null,
  tenant_id  text not null,
  project_id text not null,
  vector     vector(384) not null,
  metadata   jsonb not null default '{}'::jsonb,
  primary key (chunk_id, kb_id, tenant_id, project_id)
);

create index if not exists kb_chunks_384_scope_idx
  on kb_chunks_384 (tenant_id, project_id, kb_id);
create index if not exists kb_chunks_384_doc_idx
  on kb_chunks_384 (tenant_id, project_id, kb_id, doc_id);
create index if not exists kb_chunks_384_hnsw_idx
  on kb_chunks_384 using hnsw (vector vector_cosine_ops);

create or replace function match_kb_chunks_384(
  query_embedding vector(384),
  match_count int,
  score_threshold float,
  p_tenant_id text,
  p_project_id text,
  p_kb_id text,
  p_filter jsonb
)
returns table (
  chunk_id text, doc_id text, kb_id text, tenant_id text, project_id text,
  vector vector(384), metadata jsonb, score float
)
language sql stable
as $$
  select c.chunk_id, c.doc_id, c.kb_id, c.tenant_id, c.project_id,
         c.vector, c.metadata,
         (1 - (c.vector <=> query_embedding)) as score
  from kb_chunks_384 c
  where c.tenant_id = p_tenant_id
    and c.project_id = p_project_id
    and c.kb_id = p_kb_id
    and c.metadata @> p_filter
    and (score_threshold is null or (1 - (c.vector <=> query_embedding)) >= score_threshold)
  order by c.vector <=> query_embedding
  limit match_count
$$;

alter table kb_chunks_384 enable row level security;
create policy kb_chunks_384_tenant_isolation on kb_chunks_384
  using (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'sub')
  with check (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'sub');

create table if not exists kb_chunks_1024 (
  chunk_id   text not null,
  doc_id     text not null,
  kb_id      text not null,
  tenant_id  text not null,
  project_id text not null,
  vector     vector(1024) not null,
  metadata   jsonb not null default '{}'::jsonb,
  primary key (chunk_id, kb_id, tenant_id, project_id)
);

create index if not exists kb_chunks_1024_scope_idx
  on kb_chunks_1024 (tenant_id, project_id, kb_id);
create index if not exists kb_chunks_1024_doc_idx
  on kb_chunks_1024 (tenant_id, project_id, kb_id, doc_id);
create index if not exists kb_chunks_1024_hnsw_idx
  on kb_chunks_1024 using hnsw (vector vector_cosine_ops);

create or replace function match_kb_chunks_1024(
  query_embedding vector(1024),
  match_count int,
  score_threshold float,
  p_tenant_id text,
  p_project_id text,
  p_kb_id text,
  p_filter jsonb
)
returns table (
  chunk_id text, doc_id text, kb_id text, tenant_id text, project_id text,
  vector vector(1024), metadata jsonb, score float
)
language sql stable
as $$
  select c.chunk_id, c.doc_id, c.kb_id, c.tenant_id, c.project_id,
         c.vector, c.metadata,
         (1 - (c.vector <=> query_embedding)) as score
  from kb_chunks_1024 c
  where c.tenant_id = p_tenant_id
    and c.project_id = p_project_id
    and c.kb_id = p_kb_id
    and c.metadata @> p_filter
    and (score_threshold is null or (1 - (c.vector <=> query_embedding)) >= score_threshold)
  order by c.vector <=> query_embedding
  limit match_count
$$;

alter table kb_chunks_1024 enable row level security;
create policy kb_chunks_1024_tenant_isolation on kb_chunks_1024
  using (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'sub')
  with check (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'sub');

create table if not exists kb_chunks_1536 (
  chunk_id   text not null,
  doc_id     text not null,
  kb_id      text not null,
  tenant_id  text not null,
  project_id text not null,
  vector     vector(1536) not null,
  metadata   jsonb not null default '{}'::jsonb,
  primary key (chunk_id, kb_id, tenant_id, project_id)
);

create index if not exists kb_chunks_1536_scope_idx
  on kb_chunks_1536 (tenant_id, project_id, kb_id);
create index if not exists kb_chunks_1536_doc_idx
  on kb_chunks_1536 (tenant_id, project_id, kb_id, doc_id);
create index if not exists kb_chunks_1536_hnsw_idx
  on kb_chunks_1536 using hnsw (vector vector_cosine_ops);

create or replace function match_kb_chunks_1536(
  query_embedding vector(1536),
  match_count int,
  score_threshold float,
  p_tenant_id text,
  p_project_id text,
  p_kb_id text,
  p_filter jsonb
)
returns table (
  chunk_id text, doc_id text, kb_id text, tenant_id text, project_id text,
  vector vector(1536), metadata jsonb, score float
)
language sql stable
as $$
  select c.chunk_id, c.doc_id, c.kb_id, c.tenant_id, c.project_id,
         c.vector, c.metadata,
         (1 - (c.vector <=> query_embedding)) as score
  from kb_chunks_1536 c
  where c.tenant_id = p_tenant_id
    and c.project_id = p_project_id
    and c.kb_id = p_kb_id
    and c.metadata @> p_filter
    and (score_threshold is null or (1 - (c.vector <=> query_embedding)) >= score_threshold)
  order by c.vector <=> query_embedding
  limit match_count
$$;

alter table kb_chunks_1536 enable row level security;
create policy kb_chunks_1536_tenant_isolation on kb_chunks_1536
  using (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'sub')
  with check (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'sub');

create table if not exists kb_chunks_3072 (
  chunk_id   text not null,
  doc_id     text not null,
  kb_id      text not null,
  tenant_id  text not null,
  project_id text not null,
  vector     vector(3072) not null,
  metadata   jsonb not null default '{}'::jsonb,
  primary key (chunk_id, kb_id, tenant_id, project_id)
);

create index if not exists kb_chunks_3072_scope_idx
  on kb_chunks_3072 (tenant_id, project_id, kb_id);
create index if not exists kb_chunks_3072_doc_idx
  on kb_chunks_3072 (tenant_id, project_id, kb_id, doc_id);
-- pgvector HNSW supports at most 2000 dims for vector; cast to halfvec for 3072
create index if not exists kb_chunks_3072_hnsw_idx
  on kb_chunks_3072 using hnsw ((vector::halfvec(3072)) halfvec_cosine_ops);

create or replace function match_kb_chunks_3072(
  query_embedding vector(3072),
  match_count int,
  score_threshold float,
  p_tenant_id text,
  p_project_id text,
  p_kb_id text,
  p_filter jsonb
)
returns table (
  chunk_id text, doc_id text, kb_id text, tenant_id text, project_id text,
  vector vector(3072), metadata jsonb, score float
)
language sql stable
as $$
  select c.chunk_id, c.doc_id, c.kb_id, c.tenant_id, c.project_id,
         c.vector, c.metadata,
         (1 - (c.vector <=> query_embedding)) as score
  from kb_chunks_3072 c
  where c.tenant_id = p_tenant_id
    and c.project_id = p_project_id
    and c.kb_id = p_kb_id
    and c.metadata @> p_filter
    and (score_threshold is null or (1 - (c.vector <=> query_embedding)) >= score_threshold)
  -- Sort via the halfvec cast so the halfvec HNSW index is usable (the vector
  -- type's HNSW caps at 2000 dims); the score column stays full-precision.
  order by c.vector::halfvec(3072) <=> query_embedding::halfvec(3072)
  limit match_count
$$;

alter table kb_chunks_3072 enable row level security;
create policy kb_chunks_3072_tenant_isolation on kb_chunks_3072
  using (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'sub')
  with check (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'sub');
