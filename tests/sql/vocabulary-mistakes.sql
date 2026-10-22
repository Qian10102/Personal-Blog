-- Integration checks for the connected database. Every test write is rolled back.
begin;
do $$
declare owner uuid;
begin
  select id into owner from auth.users where lower(email)='qianzihanduo@gmail.com' limit 1;
  assert owner is not null, 'authorized test account required';
  perform set_config('request.jwt.claims',json_build_object('sub',owner,'email','qianzihanduo@gmail.com')::text,true);
  perform set_config('review_test.owner_id',owner::text,true);
  perform set_config('review_test.card_id',gen_random_uuid()::text,true);
  perform set_config('review_test.attempt',gen_random_uuid()::text,true);
end $$;
set local role authenticated;
do $$
declare
  card uuid := current_setting('review_test.card_id')::uuid;
  attempt uuid := current_setting('review_test.attempt')::uuid;
  result jsonb; again jsonb; due timestamptz; baseline integer; errors integer;
begin
  insert into public.vocabulary_cards(id,word,meaning,first_studied_at,introduced_on,due_at)
    values(card,'temporary integration check','temporary test',now()-interval '2 days',current_date-2,now()-interval '1 day');
  result := public.record_practice_answer(gen_random_uuid(),'word',true,p_card_id=>card,p_rating=>'hard');
  assert result->'mistake' = 'null'::jsonb, 'hard must not create mistake';
  assert (result->'card'->>'review_count')::integer=1;
  result := public.record_practice_answer(attempt,'word',false,p_card_id=>card,p_rating=>'again');
  assert (result->'mistake'->>'wrong_count')::integer=1;
  assert (result->'mistake'->>'stage')::integer=0;
  due := (result->'mistake'->>'next_review_at')::timestamptz;
  assert due = (result->'card'->>'due_at')::timestamptz, 'one authoritative due time';
  assert abs(extract(epoch from due-clock_timestamp())-600)<5;
  again := public.record_practice_answer(attempt,'word',false,p_card_id=>card,p_rating=>'again');
  assert (again->'mistake'->>'wrong_count')::integer=1;
  assert (again->'card'->>'review_count')::integer=2, 'retry must not increment review';
  result := public.record_practice_answer(gen_random_uuid(),'word',true,p_card_id=>card,p_rating=>'easy');
  assert (result->'mistake'->>'stage')::integer=0, 'early correct does not advance';
  assert (result->'card'->>'due_at')::timestamptz=due;
  result := public.record_practice_answer(gen_random_uuid(),'word',false,p_card_id=>card,p_rating=>'again');
  assert (result->'mistake'->>'wrong_count')::integer=2;

  select coalesce(sum(attempts),0)::integer into baseline from public.conjugation_progress where verb='aller' and tense='present';
  select coalesce(sum(wrong_count),0)::integer into errors from public.vocabulary_mistakes where kind='conjugation' and item_key='aller:present:0';
  result := public.record_practice_answer(gen_random_uuid(),'conjugation',false,'aller','present',0);
  assert (result->'progress'->>'attempts')::integer=baseline+1;
  assert (result->'mistake'->>'wrong_count')::integer=errors+1;
  assert (result->'mistake'->>'person')::integer=0;
  result := public.record_practice_answer(gen_random_uuid(),'conjugation',false,'aller','present',1);
  assert (result->'progress'->>'attempts')::integer=baseline+2;
  assert (result->'mistake'->>'item_key')='aller:present:1';
  result := public.record_practice_answer(gen_random_uuid(),'meaning',false,'vendre');
  assert result->'mistake'->>'kind'='meaning';
  begin
    perform public.record_practice_answer(gen_random_uuid(),'conjugation',false,'unknown','present',0);
    raise exception 'unknown verb accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_practice_answer(gen_random_uuid(),'conjugation',false,'aller','present',6);
    raise exception 'invalid person accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_practice_answer(gen_random_uuid(),'word',false,p_card_id=>card,p_rating=>'hard');
    raise exception 'mismatched rating accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_practice_answer(attempt,'meaning',false,'aller');
    raise exception 'receipt identity collision accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update public.vocabulary_mistakes set wrong_count=999;
    raise exception 'direct write allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Force each stage due only inside this rolled-back test transaction.
do $$
declare
  card uuid := current_setting('review_test.card_id')::uuid;
  owner uuid := (current_setting('request.jwt.claims')::jsonb->>'sub')::uuid;
  result jsonb; review_stage integer; days integer; before_count integer;
begin
  for review_stage in 0..5 loop
    update public.vocabulary_mistakes set stage=review_stage,mastered_at=null,next_review_at=clock_timestamp()-interval '100 days'
      where user_id=owner and kind='word' and card_id=card;
    result := public.record_practice_answer(gen_random_uuid(),'word',true,p_card_id=>card,p_rating=>'hard');
    if review_stage<5 then
      days := (array[1,3,7,14,30])[review_stage+1];
      assert (result->'mistake'->>'stage')::integer=review_stage+1;
      assert abs(extract(epoch from ((result->'mistake'->>'next_review_at')::timestamptz-clock_timestamp()))-days*86400)<5;
      assert result->'card'->>'due_at'=result->'mistake'->>'next_review_at';
    else
      assert result->'mistake'->>'mastered_at' is not null;
      assert result->'mistake'->'next_review_at'='null'::jsonb;
    end if;
  end loop;
  before_count := (result->'mistake'->>'wrong_count')::integer;
  result := public.record_practice_answer(gen_random_uuid(),'word',false,p_card_id=>card,p_rating=>'again');
  assert (result->'mistake'->>'wrong_count')::integer=before_count+1;
  assert (result->'mistake'->>'stage')::integer=0;
  assert result->'mistake'->'mastered_at'='null'::jsonb;
end $$;
-- Exercise the first-study date, quota and cascading deletion with disposable cards.
do $$
declare
  owner uuid := current_setting('review_test.owner_id')::uuid;
  today date := (clock_timestamp() at time zone 'Asia/Shanghai')::date;
  studied integer;
  fresh uuid := gen_random_uuid();
  attempt uuid := gen_random_uuid();
  result jsonb;
begin
  select count(*) into studied from public.vocabulary_cards where user_id=owner and introduced_on=today;
  insert into public.vocabulary_cards(id,user_id,word,meaning) values(fresh,owner,'temporary quota check','test');
  if studied<30 then
    result := public.record_practice_answer(attempt,'word',true,p_card_id=>fresh,p_rating=>'good');
    assert result->'mistake'='null'::jsonb;
    assert (result->'card'->>'introduced_on')::date=today;
    assert result->'card'->>'first_studied_at' is not null;
    result := public.record_practice_answer(attempt,'word',true,p_card_id=>fresh,p_rating=>'good');
    assert (result->'card'->>'review_count')::integer=1;
    studied := studied+1;
  end if;
  for i in 1..greatest(0,30-studied) loop
    insert into public.vocabulary_cards(user_id,word,meaning,first_studied_at,introduced_on,due_at)
      values(owner,'temporary allowance filler','test',clock_timestamp(),today,clock_timestamp()+interval '1 day');
  end loop;
  fresh := gen_random_uuid();
  attempt := gen_random_uuid();
  insert into public.vocabulary_cards(id,user_id,word,meaning) values(fresh,owner,'temporary quota rejection','test');
  begin
    perform public.record_practice_answer(attempt,'word',false,p_card_id=>fresh,p_rating=>'again');
    raise exception 'daily quota not enforced';
  exception when check_violation then null; end;
  assert not exists(select 1 from private.practice_sync_receipts where user_id=owner and attempt_id=attempt), 'rejected write must roll back its receipt';
  assert not exists(select 1 from public.vocabulary_mistakes where user_id=owner and card_id=fresh);
  delete from public.vocabulary_cards where id=current_setting('review_test.card_id')::uuid;
  assert not exists(select 1 from public.vocabulary_mistakes where user_id=owner and card_id=current_setting('review_test.card_id')::uuid), 'deleted cards cascade mistakes';
end $$;
set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claims',json_build_object('sub',gen_random_uuid(),'email','qianzihanduo@gmail.com')::text,true);
  assert not exists(select 1 from public.vocabulary_mistakes), 'owner isolation';
  perform set_config('request.jwt.claims',json_build_object('sub',current_setting('review_test.owner_id'),'email','qianzihanduo@gmail.com')::text,true);
  begin
    perform public.record_practice_answer(gen_random_uuid(),'word',false,p_card_id=>gen_random_uuid(),p_rating=>'again');
    raise exception 'foreign card accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',json_build_object('sub',gen_random_uuid(),'email','other@example.com')::text,true);
  assert not exists(select 1 from public.vocabulary_mistakes), 'email isolation';
  begin
    perform public.record_practice_answer(gen_random_uuid(),'meaning',false,'aller');
    raise exception 'unauthorized write accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform public.record_practice_answer(gen_random_uuid(),'meaning',false,'aller');
    raise exception 'anonymous RPC accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.vocabulary_mistakes;
    raise exception 'anonymous read accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
