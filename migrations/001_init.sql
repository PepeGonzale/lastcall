-- LastCall core schema.
-- The event log is the source of truth and doubles as the outbox:
-- a single append inside one transaction replaces the classic dual write
-- "save state, then publish to a broker".

create table if not exists events (
  seq            bigint generated always as identity primary key,
  event_id       uuid        not null unique,
  partition      text        not null,
  position       bigint      not null,
  type           text        not null,
  payload        jsonb       not null,
  occurred_at    timestamptz not null,
  unique (partition, position)
);

create index if not exists events_partition_position_idx on events (partition, position);

-- Command-side dedupe. An idempotency key maps to at most one outcome, so a
-- retried bid returns the original answer instead of placing a second bid.
create table if not exists idempotency (
  key        text primary key,
  event_id   uuid,
  outcome    jsonb not null,
  created_at timestamptz not null default now()
);

-- Write model (aggregate snapshot). Commands cannot read the CQRS projection:
-- it lags behind the log by design, and an auction cannot decide on stale
-- prices. This snapshot is updated in the same transaction as the append and
-- is rebuildable from the log at any time.
create table if not exists lots (
  lot_id          text primary key,
  title           text   not null,
  start_price     bigint not null,
  min_increment   bigint not null,
  current_price   bigint not null,
  leader          text,
  bid_count       integer not null default 0,
  ends_at         timestamptz not null,
  status          text   not null default 'open',
  extension_count integer not null default 0,
  version         bigint not null default -1,
  updated_at      timestamptz not null default now()
);

-- Consumer-side dedupe. Effects are applied in the same transaction as this
-- insert, so an at-least-once redelivery cannot apply twice.
create table if not exists inbox (
  consumer     text not null,
  event_id     uuid not null,
  partition    text not null,
  position     bigint not null,
  processed_at timestamptz not null default now(),
  primary key (consumer, event_id)
);

create table if not exists consumer_offsets (
  consumer   text not null,
  partition  text not null,
  position   bigint not null default -1,
  updated_at timestamptz not null default now(),
  primary key (consumer, partition)
);

-- Read model (CQRS projection).
create table if not exists lot_view (
  lot_id          text primary key,
  title           text   not null,
  start_price     bigint not null,
  min_increment   bigint not null,
  current_price   bigint not null,
  leader          text,
  bid_count       integer not null default 0,
  ends_at         timestamptz not null,
  status          text   not null default 'open',
  extension_count integer not null default 0,
  version         bigint not null default -1,
  updated_at      timestamptz not null default now()
);

create table if not exists bid_history (
  event_id   uuid primary key,
  lot_id     text   not null,
  bidder     text   not null,
  amount     bigint not null,
  position   bigint not null,
  at         timestamptz not null
);

create index if not exists bid_history_lot_idx on bid_history (lot_id, position desc);

-- Rejected commands are not facts, so they never enter the log.
create table if not exists rejections (
  id         bigint generated always as identity primary key,
  lot_id     text   not null,
  bidder     text   not null,
  amount     bigint not null,
  reason     text   not null,
  at         timestamptz not null default now()
);

-- Observability for the per-partition contiguity guard.
create table if not exists projector_gaps (
  id          bigint generated always as identity primary key,
  consumer    text   not null,
  partition   text   not null,
  expected    bigint not null,
  received    bigint not null,
  detected_at timestamptz not null default now()
);

create table if not exists chaos_log (
  id         bigint generated always as identity primary key,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);

-- Counters the UI can display without inferring anything from timings.
create table if not exists metrics (
  name  text primary key,
  value bigint not null default 0
);

-- Poison events must not stop the projector. They are parked, not retried
-- forever.
create table if not exists dead_letters (
  id         bigint generated always as identity primary key,
  consumer   text not null,
  event_id   uuid not null,
  partition  text not null,
  position   bigint not null,
  error      text not null,
  payload    jsonb,
  at         timestamptz not null default now()
);
