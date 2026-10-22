begin;

create schema if not exists private;

create table public.verb_meaning_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  verb text not null check (verb in ('être', 'avoir', 'aller', 'faire', 'dire', 'pouvoir', 'vouloir', 'savoir', 'devoir', 'voir', 'venir', 'prendre', 'mettre', 'sortir', 'partir', 'revenir', 'devenir', 'naître', 'mourir', 'lire', 'écrire', 'boire', 'sentir', 'dormir', 'courir', 'ouvrir', 'offrir', 'recevoir', 'connaître', 'comprendre', 'apprendre', 'croire', 'vivre', 'suivre', 'tenir', 'obtenir', 'conduire', 'construire', 'donner', 'parler', 'aimer', 'trouver', 'demander', 'laisser', 'penser', 'regarder', 'porter', 'apporter', 'travailler', 'jouer', 'marcher', 'chercher', 'écouter', 'oublier', 'rencontrer', 'aider', 'habiter', 'raconter', 'montrer', 'utiliser', 'gagner', 'garder', 'arrêter', 'accepter', 'décider', 'expliquer', 'préparer', 'continuer', 'étudier', 'fermer', 'inviter', 'remercier', 'visiter', 'rester', 'arriver', 'entrer', 'tomber', 'monter', 'descendre', 'retourner', 'rentrer', 'passer', 'manger', 'commencer', 'changer', 'acheter', 'appeler', 'payer', 'envoyer', 'essayer', 'finir', 'choisir', 'réussir', 'remplir', 'entendre', 'répondre', 'attendre', 'perdre', 'vendre', 'rendre')),
  attempts integer not null check (attempts > 0),
  correct integer not null check (correct between 0 and attempts),
  last_practiced_at timestamptz not null default now(),
  primary key (user_id, verb)
);

create table private.verb_meaning_sync_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null,
  primary key (user_id, attempt_id)
);

alter table public.verb_meaning_progress enable row level security;
alter table private.verb_meaning_sync_receipts enable row level security;
revoke all on public.verb_meaning_progress from public, anon, authenticated;
revoke all on private.verb_meaning_sync_receipts from public, anon, authenticated;
grant select on public.verb_meaning_progress to authenticated;

create policy "authorized owner reads meaning progress"
  on public.verb_meaning_progress for select to authenticated
  using ((select auth.uid()) = user_id
    and lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'qianzihanduo@gmail.com');

-- The privileged writer stays outside the exposed public schema. Only the
-- signed-in owner can call it; retries and counter updates commit together.
create function private.record_verb_meaning_answer(
  p_attempt_id uuid, p_verb text, p_correct boolean
) returns setof public.verb_meaning_progress
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
    or p_verb not in ('être', 'avoir', 'aller', 'faire', 'dire', 'pouvoir', 'vouloir', 'savoir', 'devoir', 'voir', 'venir', 'prendre', 'mettre', 'sortir', 'partir', 'revenir', 'devenir', 'naître', 'mourir', 'lire', 'écrire', 'boire', 'sentir', 'dormir', 'courir', 'ouvrir', 'offrir', 'recevoir', 'connaître', 'comprendre', 'apprendre', 'croire', 'vivre', 'suivre', 'tenir', 'obtenir', 'conduire', 'construire', 'donner', 'parler', 'aimer', 'trouver', 'demander', 'laisser', 'penser', 'regarder', 'porter', 'apporter', 'travailler', 'jouer', 'marcher', 'chercher', 'écouter', 'oublier', 'rencontrer', 'aider', 'habiter', 'raconter', 'montrer', 'utiliser', 'gagner', 'garder', 'arrêter', 'accepter', 'décider', 'expliquer', 'préparer', 'continuer', 'étudier', 'fermer', 'inviter', 'remercier', 'visiter', 'rester', 'arriver', 'entrer', 'tomber', 'monter', 'descendre', 'retourner', 'rentrer', 'passer', 'manger', 'commencer', 'changer', 'acheter', 'appeler', 'payer', 'envoyer', 'essayer', 'finir', 'choisir', 'réussir', 'remplir', 'entendre', 'répondre', 'attendre', 'perdre', 'vendre', 'rendre') then
    raise exception 'Invalid meaning result' using errcode = '22023';
  end if;

  insert into private.verb_meaning_sync_receipts (user_id, attempt_id)
    values (owner_id, p_attempt_id) on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 1 then
    insert into public.verb_meaning_progress as progress (user_id, verb, attempts, correct, last_practiced_at)
      values (owner_id, p_verb, 1, case when p_correct then 1 else 0 end, now())
      on conflict (user_id, verb) do update set
        attempts = progress.attempts + 1,
        correct = progress.correct + excluded.correct,
        last_practiced_at = greatest(progress.last_practiced_at, excluded.last_practiced_at);
  end if;
  return query select progress.* from public.verb_meaning_progress as progress
    where progress.user_id = owner_id and progress.verb = p_verb;
end;
$$;

-- Invoker wrapper exposes the checked operation without a public definer.
create function public.record_verb_meaning_answer(
  p_attempt_id uuid, p_verb text, p_correct boolean
) returns setof public.verb_meaning_progress
language sql security invoker set search_path = ''
as $$
  select * from private.record_verb_meaning_answer(p_attempt_id, p_verb, p_correct);
$$;

revoke all on function private.record_verb_meaning_answer(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.record_verb_meaning_answer(uuid, text, boolean) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.record_verb_meaning_answer(uuid, text, boolean) to authenticated;
grant execute on function public.record_verb_meaning_answer(uuid, text, boolean) to authenticated;

commit;
