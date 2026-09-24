create table if not exists public.vocabulary_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  word text not null check (length(trim(word)) between 1 and 120),
  meaning text not null check (length(trim(meaning)) between 1 and 500),
  example text check (example is null or length(example) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_studied_at timestamptz,
  introduced_on date,
  due_at timestamptz,
  interval_days integer not null default 0 check (interval_days >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  last_rating text check (last_rating in ('again', 'hard', 'good', 'easy')),
  constraint vocabulary_study_fields_consistent check (
    (first_studied_at is null and introduced_on is null and due_at is null)
    or (first_studied_at is not null and introduced_on is not null and due_at is not null)
  )
);

create index if not exists vocabulary_cards_user_created_idx
  on public.vocabulary_cards (user_id, created_at);
create index if not exists vocabulary_cards_user_due_idx
  on public.vocabulary_cards (user_id, due_at)
  where due_at is not null;
create index if not exists vocabulary_cards_user_introduced_idx
  on public.vocabulary_cards (user_id, introduced_on)
  where introduced_on is not null;

alter table public.vocabulary_cards enable row level security;

revoke all on table public.vocabulary_cards from anon, authenticated;
grant select, insert, update, delete on table public.vocabulary_cards to authenticated;

create policy "authorized owner reads vocabulary"
  on public.vocabulary_cards for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    and lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'qianzihanduo@gmail.com'
  );

create policy "authorized owner adds vocabulary"
  on public.vocabulary_cards for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'qianzihanduo@gmail.com'
  );

create policy "authorized owner updates vocabulary"
  on public.vocabulary_cards for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    and lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'qianzihanduo@gmail.com'
  )
  with check (
    (select auth.uid()) = user_id
    and lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'qianzihanduo@gmail.com'
  );

create policy "authorized owner deletes vocabulary"
  on public.vocabulary_cards for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    and lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'qianzihanduo@gmail.com'
  );
