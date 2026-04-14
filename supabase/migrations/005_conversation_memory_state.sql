-- Structured conversation memory (intent, dimension, entity refs) for safer multi-turn follow-ups.

alter table public.conversations
  add column if not exists memory_state jsonb not null default '{}'::jsonb,
  add column if not exists memory_updated_at timestamptz;

create index if not exists conversations_memory_updated_at_idx
  on public.conversations (memory_updated_at desc nulls last);
