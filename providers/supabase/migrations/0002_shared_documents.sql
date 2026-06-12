-- 0002_shared_documents.sql
create table if not exists shared_documents (
  doc_id      text not null,
  kb_id       text not null,
  tenant_id   text not null,
  project_id  text not null,
  data        text not null,
  metadata    jsonb not null default '{}'::jsonb,
  primary key (doc_id, kb_id, tenant_id, project_id)
);
create index if not exists shared_documents_scope on shared_documents (tenant_id, project_id, kb_id);

alter table shared_documents enable row level security;
create policy shared_documents_tenant_isolation on shared_documents
  using (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'sub')
  with check (tenant_id = current_setting('request.jwt.claims', true)::jsonb->>'sub');
