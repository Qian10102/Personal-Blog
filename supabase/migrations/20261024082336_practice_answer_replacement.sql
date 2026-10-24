begin;

-- No typed answers: only the minimal state needed to replace a submitted rating.
create table private.practice_answers (
  sequence bigint generated always as identity unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null,
  kind text not null,
  item_key text not null,
  verb text, tense text, person integer,
  card_id uuid references public.vocabulary_cards(id) on delete cascade,
  correct boolean not null, rating text, timezone text not null,
  stamp timestamptz not null,
  revision integer not null default 0,
  before_mistake jsonb, before_card jsonb, after_card jsonb,
  primary key (user_id, attempt_id)
);
create index practice_answers_item_idx on private.practice_answers(user_id,kind,item_key,sequence);
create table private.practice_replacements (
  user_id uuid not null references auth.users(id) on delete cascade,
  revision_id uuid not null,
  attempt_id uuid not null,
  expected_revision integer not null,
  correct boolean not null, rating text,
  result jsonb not null,
  primary key(user_id,revision_id),
  foreign key(user_id,attempt_id) references private.practice_answers(user_id,attempt_id) on delete cascade
);
alter table private.practice_answers enable row level security;
alter table private.practice_replacements enable row level security;
revoke all on private.practice_answers, private.practice_replacements from public,anon,authenticated;

create function private.apply_practice_answer(
  p_attempt_id uuid, p_kind text, p_correct boolean,
  p_verb text default null, p_tense text default null, p_person integer default null,
  p_card_id uuid default null, p_rating text default null, p_timezone text default 'Asia/Shanghai',
  p_stamp timestamptz default clock_timestamp(), p_replay boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  item text;
  inserted integer;
  m public.vocabulary_mistakes;
  card public.vocabulary_cards;
  progress jsonb;
  stamp timestamptz := p_stamp;
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

  if p_replay then inserted := 1;
  else
  insert into private.practice_sync_receipts values(owner_id,p_attempt_id,p_kind,item) on conflict do nothing;
  get diagnostics inserted = row_count;
  if not exists (select 1 from private.practice_sync_receipts r where r.user_id = owner_id and r.attempt_id = p_attempt_id and r.kind = p_kind and r.item_key = item) then
    raise exception 'Attempt ID belongs to another question' using errcode = '22023';
  end if;
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
      if not p_replay and card.first_studied_at is null and (select count(*) from public.vocabulary_cards where user_id = owner_id and introduced_on = today) >= 30 then
        raise exception 'Daily new-word allowance reached' using errcode = '23514';
      end if;
    elsif p_kind = 'meaning' and not p_replay then
      perform * from private.record_verb_meaning_answer(p_attempt_id,p_verb,p_correct);
    elsif p_kind = 'conjugation' and not p_replay then
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


revoke all on function private.apply_practice_answer(uuid,text,boolean,text,text,integer,uuid,text,text,timestamptz,boolean) from public,anon,authenticated;

-- The existing public endpoint stays compatible with older clients and receipts.
create or replace function private.record_practice_answer(
  p_attempt_id uuid, p_kind text, p_correct boolean,
  p_verb text default null, p_tense text default null, p_person integer default null,
  p_card_id uuid default null, p_rating text default null, p_timezone text default 'Asia/Shanghai'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  item text := case when p_kind='word' then p_card_id::text when p_kind='meaning' then p_verb else p_verb||':'||p_tense||':'||p_person::text end;
  before_m jsonb; before_c jsonb; result jsonb;
  stamp timestamptz := clock_timestamp();
  recorded private.practice_answers;
  old_receipt boolean;
begin
  if owner_id is null or lower(coalesce(auth.jwt()->>'email','')) <> 'qianzihanduo@gmail.com' then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  -- Lock before snapshots; same order for new writes and replacements.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text || ':' || case when p_kind='word' then 'word' else p_kind||':'||item end,0));
  select * into recorded from private.practice_answers where user_id=owner_id and attempt_id=p_attempt_id;
  if found then
    if recorded.kind is distinct from p_kind or recorded.item_key is distinct from item
      or recorded.verb is distinct from p_verb or recorded.tense is distinct from p_tense
      or recorded.person is distinct from p_person or recorded.card_id is distinct from p_card_id then
      raise exception 'Attempt ID belongs to another question' using errcode='22023';
    end if;
    -- A delayed retry of the original answer must never undo a replacement.
    result := private.apply_practice_answer(p_attempt_id,p_kind,recorded.correct,p_verb,p_tense,p_person,p_card_id,recorded.rating,recorded.timezone,stamp,false);
    return result || jsonb_build_object('revision',recorded.revision,'correct',recorded.correct);
  end if;
  select exists(select 1 from private.practice_sync_receipts where user_id=owner_id and attempt_id=p_attempt_id) into old_receipt;
  select to_jsonb(m) into before_m from public.vocabulary_mistakes m where user_id=owner_id and kind=p_kind and item_key=item;
  if p_kind='word' then
    select to_jsonb(c) into before_c from public.vocabulary_cards c where user_id=owner_id and id=p_card_id for update;
  end if;
  result := private.apply_practice_answer(p_attempt_id,p_kind,p_correct,p_verb,p_tense,p_person,p_card_id,p_rating,p_timezone,stamp,false);
  if not old_receipt then
    insert into private.practice_answers(user_id,attempt_id,kind,item_key,verb,tense,person,card_id,correct,rating,timezone,stamp,before_mistake,before_card,after_card)
      values(owner_id,p_attempt_id,p_kind,item,p_verb,p_tense,p_person,p_card_id,p_correct,p_rating,p_timezone,stamp,before_m,before_c,nullif(result->'card','null'::jsonb));
  end if;
  return result || jsonb_build_object('revision',0,'correct',p_correct);
end;
$$;

create function private.replace_practice_answer(
  p_attempt_id uuid, p_revision_id uuid, p_expected_revision integer, p_correct boolean, p_rating text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  target private.practice_answers;
  delivery private.practice_replacements;
  event private.practice_answers;
  latest private.practice_answers;
  saved_card public.vocabulary_cards;
  result jsonb; before_m jsonb; before_c jsonb;
  difference integer;
begin
  if owner_id is null or lower(coalesce(auth.jwt()->>'email','')) <> 'qianzihanduo@gmail.com' then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  if p_attempt_id is null or p_revision_id is null or p_expected_revision is null or p_expected_revision<0 or p_correct is null then
    raise exception 'Invalid replacement' using errcode='22023';
  end if;
  select * into target from private.practice_answers where user_id=owner_id and attempt_id=p_attempt_id;
  if not found then raise exception 'Answer not found' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text || ':' || case when target.kind='word' then 'word' else target.kind||':'||target.item_key end,0));
  select * into delivery from private.practice_replacements where user_id=owner_id and revision_id=p_revision_id;
  if found then
    if delivery.attempt_id is distinct from p_attempt_id or delivery.expected_revision is distinct from p_expected_revision
      or delivery.correct is distinct from p_correct or delivery.rating is distinct from p_rating then
      raise exception 'Revision ID reused for another change' using errcode='22023';
    end if;
    return delivery.result;
  end if;
  select * into target from private.practice_answers where user_id=owner_id and attempt_id=p_attempt_id for update;
  if target.revision<>p_expected_revision then raise exception 'Answer was changed in another tab' using errcode='40001'; end if;
  if (target.kind='word' and (p_rating is null or p_rating not in ('again','hard','good','easy') or p_correct<>(p_rating<>'again')))
    or (target.kind<>'word' and p_rating is not null) then
    raise exception 'Invalid rating' using errcode='22023';
  end if;
  if target.kind='word' then
    select * into saved_card from public.vocabulary_cards where user_id=owner_id and id=target.card_id for update;
    if not found then raise exception 'Card not found' using errcode='42501'; end if;
    select * into latest from private.practice_answers where user_id=owner_id and kind=target.kind and item_key=target.item_key order by sequence desc limit 1;
    if saved_card.review_count <> (latest.after_card->>'review_count')::integer then
      raise exception 'Card was reviewed by an older client; start a new round' using errcode='40001';
    end if;
  end if;
  difference := p_correct::integer-target.correct::integer;
  update private.practice_answers set correct=p_correct,rating=p_rating,revision=revision+1 where user_id=owner_id and attempt_id=p_attempt_id;
  -- Restore the state immediately before this occurrence, then replay later
  -- occurrences at their ORIGINAL times. This preserves later genuine answers.
  delete from public.vocabulary_mistakes where user_id=owner_id and kind=target.kind and item_key=target.item_key;
  if target.before_mistake is not null then
    insert into public.vocabulary_mistakes select (jsonb_populate_record(null::public.vocabulary_mistakes,target.before_mistake)).*;
  end if;
  if target.kind='word' then
    saved_card := jsonb_populate_record(null::public.vocabulary_cards,target.before_card);
    update public.vocabulary_cards set first_studied_at=saved_card.first_studied_at,introduced_on=saved_card.introduced_on,
      due_at=saved_card.due_at,interval_days=saved_card.interval_days,review_count=saved_card.review_count,last_rating=saved_card.last_rating
      where user_id=owner_id and id=target.card_id;
  elsif target.kind='meaning' then
    update public.verb_meaning_progress set correct=correct+difference where user_id=owner_id and verb=target.verb;
  else
    update public.conjugation_progress set correct=correct+difference where user_id=owner_id and verb=target.verb and tense=target.tense;
  end if;
  for event in select * from private.practice_answers where user_id=owner_id and kind=target.kind and item_key=target.item_key and sequence>=target.sequence order by sequence loop
    select to_jsonb(m) into before_m from public.vocabulary_mistakes m where user_id=owner_id and kind=target.kind and item_key=target.item_key;
    select to_jsonb(c) into before_c from public.vocabulary_cards c where user_id=owner_id and id=target.card_id;
    result := private.apply_practice_answer(event.attempt_id,event.kind,event.correct,event.verb,event.tense,event.person,event.card_id,event.rating,event.timezone,event.stamp,true);
    update private.practice_answers set before_mistake=before_m,before_card=before_c,after_card=nullif(result->'card','null'::jsonb)
      where user_id=owner_id and attempt_id=event.attempt_id;
  end loop;
  result := result || jsonb_build_object('revision',target.revision+1,'correct',p_correct);
  insert into private.practice_replacements values(owner_id,p_revision_id,p_attempt_id,p_expected_revision,p_correct,p_rating,result);
  return result;
end;
$$;

create function public.replace_practice_answer(
  p_attempt_id uuid,p_revision_id uuid,p_expected_revision integer,p_correct boolean,p_rating text default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.replace_practice_answer(p_attempt_id,p_revision_id,p_expected_revision,p_correct,p_rating);
$$;
revoke all on function private.replace_practice_answer(uuid,uuid,integer,boolean,text) from public,anon,authenticated;
revoke all on function public.replace_practice_answer(uuid,uuid,integer,boolean,text) from public,anon,authenticated;
grant execute on function private.replace_practice_answer(uuid,uuid,integer,boolean,text) to authenticated;
grant execute on function public.replace_practice_answer(uuid,uuid,integer,boolean,text) to authenticated;

commit;
