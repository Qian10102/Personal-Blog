begin;

create table public.conjugation_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  verb text not null check (length(trim(verb)) between 1 and 120),
  tense text not null check (tense in ('present', 'passe-compose', 'imparfait', 'futur', 'conditionnel', 'subjonctif')),
  attempts integer not null check (attempts > 0),
  correct integer not null check (correct between 0 and attempts),
  last_practiced_at timestamptz not null default now(),
  primary key (user_id, verb, tense)
);

-- Only opaque delivery IDs, never answers or a per-question practice history.
-- A receipt and its counter update commit together, so a timed-out request can
-- be retried even from another tab without counting the same answer twice.
create table public.conjugation_sync_receipts (
  user_id uuid not null references auth.users (id) on delete cascade,
  attempt_id uuid not null,
  primary key (user_id, attempt_id)
);

alter table public.conjugation_progress enable row level security;
alter table public.conjugation_sync_receipts enable row level security;
revoke all on public.conjugation_progress from public, anon, authenticated;
revoke all on public.conjugation_sync_receipts from public, anon, authenticated;
grant select on public.conjugation_progress to authenticated;

create policy "authorized owner reads conjugation progress"
  on public.conjugation_progress for select to authenticated
  using (
    (select auth.uid()) = user_id
    and lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'qianzihanduo@gmail.com'
  );

-- Writes are restricted to this function so counters cannot be overwritten by
-- concurrent clients. The definer checks both identity and the authorized email.
create function public.record_conjugation_answer(
  p_attempt_id uuid, p_verb text, p_tense text, p_correct boolean
) returns setof public.conjugation_progress
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  inserted integer;
begin
  if owner_id is null or lower(coalesce(auth.jwt() ->> 'email', '')) <> 'qianzihanduo@gmail.com' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_attempt_id is null or p_correct is null or p_verb is null
    or length(trim(p_verb)) not between 1 and 120
    or p_tense is null or p_tense not in ('present', 'passe-compose', 'imparfait', 'futur', 'conditionnel', 'subjonctif') then
    raise exception 'Invalid practice result' using errcode = '22023';
  end if;

  insert into public.conjugation_sync_receipts (user_id, attempt_id)
    values (owner_id, p_attempt_id) on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 1 then
    insert into public.conjugation_progress as progress (user_id, verb, tense, attempts, correct, last_practiced_at)
      values (owner_id, p_verb, p_tense, 1, case when p_correct then 1 else 0 end, now())
      on conflict (user_id, verb, tense) do update set
        attempts = progress.attempts + 1,
        correct = progress.correct + excluded.correct,
        last_practiced_at = greatest(progress.last_practiced_at, excluded.last_practiced_at);
  end if;
  return query select progress.* from public.conjugation_progress as progress
    where progress.user_id = owner_id and progress.verb = p_verb and progress.tense = p_tense;
end;
$$;

revoke all on function public.record_conjugation_answer(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_conjugation_answer(uuid, text, text, boolean) to authenticated;

commit;
