-- Global read cursor per consumer.
--
-- Per-partition offsets are the correctness mechanism; this is the resume
-- point after a restart. Without it the projector can only replay from zero,
-- which is safe but makes every restart look like a flood of duplicates.

create table if not exists consumer_cursor (
  consumer   text primary key,
  seq        bigint not null default 0,
  updated_at timestamptz not null default now()
);
