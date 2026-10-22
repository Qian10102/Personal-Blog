begin;

create table public.vocabulary_mistakes (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('word', 'conjugation', 'meaning')),
  item_key text not null check (length(item_key) between 1 and 200),
  card_id uuid references public.vocabulary_cards(id) on delete cascade,
  verb text,
  tense text,
  person integer,
  stage integer not null check (stage between 0 and 5),
  wrong_count integer not null check (wrong_count > 0),
  next_review_at timestamptz,
  mastered_at timestamptz,
  last_correct boolean not null,
  last_practiced_at timestamptz not null,
  primary key (user_id, kind, item_key),
  check ((mastered_at is null and next_review_at is not null) or (mastered_at is not null and next_review_at is null)),
  check ((kind = 'word' and card_id is not null and verb is null and tense is null and person is null)
    or (kind = 'meaning' and card_id is null and verb is not null and tense is null and person is null)
    or (kind = 'conjugation' and card_id is null and verb is not null and tense in ('present','passe-compose','imparfait','futur','conditionnel','subjonctif') and person between 0 and 5))
);
create index vocabulary_mistakes_due_idx on public.vocabulary_mistakes(user_id, kind, next_review_at) where mastered_at is null;
create index vocabulary_mistakes_card_idx on public.vocabulary_mistakes(card_id) where card_id is not null;
alter table public.vocabulary_mistakes enable row level security;
revoke all on public.vocabulary_mistakes from public, anon, authenticated;
grant select on public.vocabulary_mistakes to authenticated;
create policy "authorized owner reads mistakes" on public.vocabulary_mistakes for select to authenticated
  using ((select auth.uid()) = user_id and lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'qianzihanduo@gmail.com');

-- Opaque delivery IDs only; no typed answers or duplicated card content.
create table private.practice_sync_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null,
  kind text not null,
  item_key text not null,
  primary key(user_id, attempt_id)
);
alter table private.practice_sync_receipts enable row level security;
revoke all on private.practice_sync_receipts from public, anon, authenticated;

create function private.record_practice_answer(
  p_attempt_id uuid, p_kind text, p_correct boolean,
  p_verb text default null, p_tense text default null, p_person integer default null,
  p_card_id uuid default null, p_rating text default null, p_timezone text default 'Asia/Shanghai'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  item text;
  inserted integer;
  m public.vocabulary_mistakes;
  card public.vocabulary_cards;
  progress jsonb;
  stamp timestamptz := clock_timestamp();
  intervals interval[] := array[interval '10 minutes', interval '1 day', interval '3 days', interval '7 days', interval '14 days', interval '30 days'];
  days integer;
  review_due timestamptz;
  today date;
begin
  if owner_id is null or lower(coalesce(auth.jwt() ->> 'email', '')) <> 'qianzihanduo@gmail.com' then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_attempt_id is null or p_correct is null or p_kind is null or p_kind not in ('word','conjugation','meaning') then
    raise exception 'Invalid practice result' using errcode = '22023';
  end if;
  if p_kind = 'word' then
    if p_card_id is null or p_rating is null or p_rating not in ('again','hard','good','easy')
      or p_correct <> (p_rating <> 'again') or p_verb is not null or p_tense is not null or p_person is not null
      or p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
      raise exception 'Invalid card result' using errcode = '22023';
    end if;
    item := p_card_id::text;
  else
    if p_verb is null or not (p_verb = any (array['être', 'avoir', 'aller', 'faire', 'dire', 'pouvoir', 'vouloir', 'savoir', 'devoir', 'voir', 'venir', 'prendre', 'mettre', 'sortir', 'partir', 'revenir', 'devenir', 'naître', 'mourir', 'lire', 'écrire', 'boire', 'sentir', 'dormir', 'courir', 'ouvrir', 'offrir', 'recevoir', 'connaître', 'comprendre', 'apprendre', 'croire', 'vivre', 'suivre', 'tenir', 'obtenir', 'conduire', 'construire', 'donner', 'parler', 'aimer', 'trouver', 'demander', 'laisser', 'penser', 'regarder', 'porter', 'apporter', 'travailler', 'jouer', 'marcher', 'chercher', 'écouter', 'oublier', 'rencontrer', 'aider', 'habiter', 'raconter', 'montrer', 'utiliser', 'gagner', 'garder', 'arrêter', 'accepter', 'décider', 'expliquer', 'préparer', 'continuer', 'étudier', 'fermer', 'inviter', 'remercier', 'visiter', 'rester', 'arriver', 'entrer', 'tomber', 'monter', 'descendre', 'retourner', 'rentrer', 'passer', 'manger', 'commencer', 'changer', 'acheter', 'appeler', 'payer', 'envoyer', 'essayer', 'finir', 'choisir', 'réussir', 'remplir', 'entendre', 'répondre', 'attendre', 'perdre', 'vendre', 'rendre']::text[]))
      or p_card_id is not null or p_rating is not null
      or (p_kind = 'meaning' and (p_tense is not null or p_person is not null))
      or (p_kind = 'conjugation' and (p_tense is null or p_tense not in ('present','passe-compose','imparfait','futur','conditionnel','subjonctif') or p_person is null or p_person not between 0 and 5)) then
      raise exception 'Invalid verb result' using errcode = '22023';
    end if;
    item := case when p_kind = 'meaning' then p_verb else p_verb || ':' || p_tense || ':' || p_person::text end;
  end if;

  insert into private.practice_sync_receipts values(owner_id,p_attempt_id,p_kind,item) on conflict do nothing;
  get diagnostics inserted = row_count;
  if not exists (select 1 from private.practice_sync_receipts r where r.user_id = owner_id and r.attempt_id = p_attempt_id and r.kind = p_kind and r.item_key = item) then
    raise exception 'Attempt ID belongs to another question' using errcode = '22023';
  end if;
  -- Serialize each user's word writes to enforce the daily new-word allowance;
  -- verb writes serialize only the matching mistake identity.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text || ':' || case when p_kind = 'word' then 'word' else p_kind || ':' || item end, 0));
  select * into m from public.vocabulary_mistakes where user_id = owner_id and kind = p_kind and item_key = item for update;
  if inserted = 1 then
    if p_kind = 'word' then
      select * into card from public.vocabulary_cards where id = p_card_id and user_id = owner_id for update;
      if not found then raise exception 'Card not found' using errcode = '42501'; end if;
      today := (stamp at time zone p_timezone)::date;
      if card.first_studied_at is null and (select count(*) from public.vocabulary_cards where user_id = owner_id and introduced_on = today) >= 30 then
        raise exception 'Daily new-word allowance reached' using errcode = '23514';
      end if;
    elsif p_kind = 'meaning' then
      perform * from private.record_verb_meaning_answer(p_attempt_id,p_verb,p_correct);
    else
      perform * from public.record_conjugation_answer(p_attempt_id,p_verb,p_tense,p_correct);
    end if;

    if not p_correct then
      insert into public.vocabulary_mistakes as old (user_id,kind,item_key,card_id,verb,tense,person,stage,wrong_count,next_review_at,mastered_at,last_correct,last_practiced_at)
        values(owner_id,p_kind,item,p_card_id,p_verb,p_tense,p_person,0,1,stamp + intervals[1],null,false,stamp)
        on conflict(user_id,kind,item_key) do update set
          stage=0,wrong_count=old.wrong_count+1,next_review_at=excluded.next_review_at,mastered_at=null,last_correct=false,last_practiced_at=stamp;
    elsif m.user_id is not null then
      if m.mastered_at is null and m.next_review_at <= stamp then
        if m.stage = 5 then
          m.mastered_at := stamp;
          m.next_review_at := null;
        else
          m.stage := m.stage+1;
          m.next_review_at := stamp+intervals[m.stage+1];
        end if;
      end if;
      update public.vocabulary_mistakes set stage=m.stage,next_review_at=m.next_review_at,mastered_at=m.mastered_at,last_correct=true,last_practiced_at=stamp
        where user_id=owner_id and kind=p_kind and item_key=item;
    end if;
    select * into m from public.vocabulary_mistakes where user_id=owner_id and kind=p_kind and item_key=item;
    if p_kind = 'word' then
      days := case p_rating when 'again' then 0 when 'hard' then 1 when 'good' then case when card.interval_days <= 0 then 1 else greatest(card.interval_days+1,round(card.interval_days*2)::integer) end
        else case when card.interval_days <= 0 then 3 else greatest(card.interval_days+1,round(card.interval_days*2.5)::integer) end end;
      review_due := stamp + case when p_rating='again' then intervals[1] else days*interval '1 day' end;
      if m.user_id is not null and m.mastered_at is null then
        review_due := m.next_review_at;
        days := case m.stage when 0 then 0 when 1 then 1 when 2 then 3 when 3 then 7 when 4 then 14 else 30 end;
      end if;
      update public.vocabulary_cards set first_studied_at=coalesce(card.first_studied_at,stamp),introduced_on=coalesce(card.introduced_on,today),
        due_at=review_due,interval_days=days,review_count=card.review_count+1,last_rating=p_rating,updated_at=stamp
        where id=p_card_id and user_id=owner_id;
    end if;
  end if;
  if p_kind='word' then
    select * into card from public.vocabulary_cards where id=p_card_id and user_id=owner_id;
  elsif p_kind='meaning' then
    select to_jsonb(p) into progress from public.verb_meaning_progress p where user_id=owner_id and verb=p_verb;
  else
    select to_jsonb(p) into progress from public.conjugation_progress p where user_id=owner_id and verb=p_verb and tense=p_tense;
  end if;
  return jsonb_build_object('progress',progress,'card',case when card.id is null then null else to_jsonb(card) end,'mistake',case when m.user_id is null then null else to_jsonb(m) end);
end;
$$;

create function public.record_practice_answer(
  p_attempt_id uuid, p_kind text, p_correct boolean,
  p_verb text default null, p_tense text default null, p_person integer default null,
  p_card_id uuid default null, p_rating text default null, p_timezone text default 'Asia/Shanghai'
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.record_practice_answer(p_attempt_id,p_kind,p_correct,p_verb,p_tense,p_person,p_card_id,p_rating,p_timezone);
$$;
revoke all on function private.record_practice_answer(uuid,text,boolean,text,text,integer,uuid,text,text) from public,anon,authenticated;
revoke all on function public.record_practice_answer(uuid,text,boolean,text,text,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function private.record_practice_answer(uuid,text,boolean,text,text,integer,uuid,text,text) to authenticated;
grant execute on function public.record_practice_answer(uuid,text,boolean,text,text,integer,uuid,text,text) to authenticated;

commit;
