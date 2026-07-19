-- Run this entire file once in your Supabase project's SQL Editor
-- (Project -> SQL Editor -> New query -> paste -> Run)

create extension if not exists pgcrypto;

create table if not exists secrets (
  id uuid primary key default gen_random_uuid(),
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now(),
  views integer not null default 0,
  reactions jsonb not null default '{"😂":0,"😢":0,"❤️":0,"😮":0,"😡":0}'::jsonb
);

alter table secrets enable row level security;

-- Anyone can read secrets (needed to browse random ones)
create policy "Anyone can read secrets"
  on secrets for select
  using (true);

-- Anyone can post a secret, but only the content column is ever set by them
create policy "Anyone can insert secrets"
  on secrets for insert
  with check (char_length(content) between 1 and 500);

-- Safely increment the view counter, bypassing the need for direct UPDATE access
create or replace function increment_view(secret_id uuid)
returns void as $$
begin
  update secrets set views = views + 1 where id = secret_id;
end;
$$ language plpgsql security definer;

-- Safely add one emoji reaction, validating the emoji against the allowed set
create or replace function add_reaction(secret_id uuid, emoji_key text)
returns void as $$
begin
  if emoji_key not in ('😂', '😢', '❤️', '😮', '😡') then
    raise exception 'invalid emoji';
  end if;

  update secrets
  set reactions = jsonb_set(
    reactions,
    array[emoji_key],
    to_jsonb(coalesce((reactions ->> emoji_key)::int, 0) + 1)
  )
  where id = secret_id;
end;
$$ language plpgsql security definer;

-- Fetch one random secret, optionally excluding ids the visitor has already
-- seen. Secrets older than 7 days are treated as expired and never returned.
create or replace function get_random_secret(exclude_ids uuid[] default '{}')
returns setof secrets as $$
  select *
  from secrets
  where not (id = any(exclude_ids))
    and created_at > now() - interval '7 days'
  order by random()
  limit 1;
$$ language sql stable;

-- Same idea, but restricted to a specific set of ids — used for "My Feed"
-- (secrets the visitor posted or reacted to). Still enforces the same
-- 7-day expiration so old posts drop out of My Feed too.
create or replace function get_random_secret_from_ids(
  candidate_ids uuid[],
  exclude_ids uuid[] default '{}'
)
returns setof secrets as $$
  select *
  from secrets
  where id = any(candidate_ids)
    and not (id = any(exclude_ids))
    and created_at > now() - interval '7 days'
  order by random()
  limit 1;
$$ language sql stable;

grant execute on function increment_view(uuid) to anon;
grant execute on function add_reaction(uuid, text) to anon;
grant execute on function get_random_secret(uuid[]) to anon;
grant execute on function get_random_secret_from_ids(uuid[], uuid[]) to anon;

-- ---------- Reports ----------
-- Tracks reports filed against secrets so you can review them later.
-- Deliberately write-only for visitors: they can file a report, but cannot
-- read the reports table back. You review reports yourself in the Supabase
-- dashboard (Table Editor, or SQL Editor), which uses your service role and
-- bypasses RLS entirely — no separate admin login needed.

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  secret_id uuid not null references secrets(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table reports enable row level security;

create policy "Anyone can file a report"
  on reports for insert
  with check (true);

-- Handy query to review the most-reported secrets, paste into SQL Editor:
-- select s.id, s.content, count(r.id) as report_count
-- from secrets s
-- join reports r on r.secret_id = s.id
-- group by s.id, s.content
-- order by report_count desc;