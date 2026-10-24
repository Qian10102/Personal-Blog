-- Every assertion runs inside a transaction and leaves no learning records.
begin;
do $$
declare owner uuid;
begin
  select id into owner from auth.users where lower(email)='qianzihanduo@gmail.com' limit 1;
  assert owner is not null;
  perform set_config('request.jwt.claims',json_build_object('sub',owner,'email','qianzihanduo@gmail.com')::text,true);
  perform set_config('replacement_test.owner',owner::text,true);
end $$;
set local role authenticated;
do $$
declare
  card uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); rev uuid := gen_random_uuid();
  result jsonb; repeated jsonb; due text;
  attempts_before integer; correct_before integer;
begin
  insert into public.vocabulary_cards(id,word,meaning,first_studied_at,introduced_on,due_at)
    values(card,'temporary replacement test','测试',now()-interval '3 days',current_date-3,now()-interval '1 day');
  result := public.record_practice_answer(a,'word',false,p_card_id=>card,p_rating=>'again');
  due := result->'mistake'->>'next_review_at';
  assert (result->'card'->>'review_count')::integer=1;
  result := public.replace_practice_answer(a,rev,0,true,'easy');
  assert (result->'card'->>'review_count')::integer=1, 'replacement adds no review';
  assert result->'mistake'='null'::jsonb, 'wrong to correct removes new mistake';
  assert (result->>'revision')::integer=1;
  repeated := public.replace_practice_answer(a,rev,0,true,'easy');
  assert result=repeated, 'lost response retry is idempotent';
  result := public.record_practice_answer(a,'word',false,p_card_id=>card,p_rating=>'again');
  assert result->'mistake'='null'::jsonb, 'old submission retry cannot undo replacement';
  assert (result->'card'->>'review_count')::integer=1;
  begin
    perform public.replace_practice_answer(a,gen_random_uuid(),0,false,'again');
    raise exception 'stale replacement accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.replace_practice_answer(a,rev,0,false,'again');
    raise exception 'revision ID reused';
  exception when invalid_parameter_value then null; end;
  result := public.replace_practice_answer(a,gen_random_uuid(),1,false,'again');
  assert result->'mistake'->>'next_review_at'=due, 'original answer time retained';
  assert (result->'mistake'->>'wrong_count')::integer=1;
  result := public.record_practice_answer(b,'word',true,p_card_id=>card,p_rating=>'good');
  assert (result->'card'->>'review_count')::integer=2;
  assert result->'mistake'->>'next_review_at'=due, 'immediate retry does not advance stage';
  result := public.replace_practice_answer(a,gen_random_uuid(),2,true,'hard');
  assert (result->'card'->>'review_count')::integer=2, 'later occurrence retained';
  assert result->'mistake'='null'::jsonb;
  result := public.replace_practice_answer(b,gen_random_uuid(),0,false,'again');
  assert (result->'mistake'->>'wrong_count')::integer=1;
  assert (result->'card'->>'review_count')::integer=2;
  result := public.replace_practice_answer(a,gen_random_uuid(),3,false,'again');
  assert (result->'mistake'->>'wrong_count')::integer=2, 'replay uses revised baseline of later answer';
  assert (result->'card'->>'review_count')::integer=2;
  delete from public.vocabulary_cards where id=card;
  begin
    perform public.replace_practice_answer(a,gen_random_uuid(),4,true,'good');
    raise exception 'deleted card answer accepted';
  exception when insufficient_privilege then null; end;

  select coalesce(sum(attempts),0)::integer,coalesce(sum(correct),0)::integer into attempts_before,correct_before from public.verb_meaning_progress where verb='rendre';
  a := gen_random_uuid();
  result := public.record_practice_answer(a,'meaning',false,'rendre');
  result := public.replace_practice_answer(a,gen_random_uuid(),0,true);
  assert (result->'progress'->>'attempts')::integer=attempts_before+1;
  assert (result->'progress'->>'correct')::integer=correct_before+1;
  result := public.replace_practice_answer(a,gen_random_uuid(),1,false);
  assert (result->'progress'->>'attempts')::integer=attempts_before+1;
  assert (result->'progress'->>'correct')::integer=correct_before;

  select coalesce(sum(attempts),0)::integer,coalesce(sum(correct),0)::integer into attempts_before,correct_before from public.conjugation_progress where verb='rendre' and tense='present';
  a := gen_random_uuid(); b := gen_random_uuid();
  result := public.record_practice_answer(a,'conjugation',true,'rendre','present',0);
  result := public.record_practice_answer(b,'conjugation',false,'rendre','present',1);
  result := public.replace_practice_answer(a,gen_random_uuid(),0,false);
  assert (result->'progress'->>'attempts')::integer=attempts_before+2;
  assert (result->'progress'->>'correct')::integer=correct_before;
  result := public.replace_practice_answer(b,gen_random_uuid(),0,true);
  assert (result->'progress'->>'attempts')::integer=attempts_before+2;
  assert (result->'progress'->>'correct')::integer=correct_before+1;
  perform set_config('replacement_test.answer',a::text,true);
  begin
    perform * from private.practice_answers;
    raise exception 'private snapshots readable';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',json_build_object('sub',gen_random_uuid(),'email','qianzihanduo@gmail.com')::text,true);
  begin
    perform public.replace_practice_answer(a,gen_random_uuid(),1,true);
    raise exception 'foreign answer accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',json_build_object('sub',current_setting('replacement_test.owner'),'email','other@example.com')::text,true);
  begin
    perform public.replace_practice_answer(a,gen_random_uuid(),1,true);
    raise exception 'unauthorized email accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- A replacement must preserve a pre-existing mistake and restore mastery.
do $$
declare
  owner uuid := current_setting('replacement_test.owner')::uuid;
  card uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims',json_build_object('sub',owner,'email','qianzihanduo@gmail.com')::text,true);
  insert into public.vocabulary_cards(id,user_id,word,meaning,first_studied_at,introduced_on,due_at,review_count)
    values(card,owner,'temporary mastery replacement','测试',now()-interval '40 days',current_date-40,now()-interval '1 day',7);
  insert into public.vocabulary_mistakes(user_id,kind,item_key,card_id,stage,wrong_count,next_review_at,last_correct,last_practiced_at)
    values(owner,'word',card::text,card,5,7,now()-interval '1 day',false,now()-interval '40 days');
  perform set_config('replacement_test.mastery_card',card::text,true);
end $$;
set local role authenticated;
do $$
declare
  card uuid := current_setting('replacement_test.mastery_card')::uuid;
  attempt uuid := gen_random_uuid(); result jsonb;
begin
  result := public.record_practice_answer(attempt,'word',true,p_card_id=>card,p_rating=>'good');
  assert result->'mistake'->>'mastered_at' is not null;
  result := public.replace_practice_answer(attempt,gen_random_uuid(),0,false,'again');
  assert (result->'mistake'->>'wrong_count')::integer=8;
  assert result->'mistake'->'mastered_at'='null'::jsonb;
  assert (result->'card'->>'review_count')::integer=8;
  result := public.replace_practice_answer(attempt,gen_random_uuid(),1,true,'good');
  assert result->'mistake'->>'mastered_at' is not null;
  assert (result->'mistake'->>'wrong_count')::integer=7, 'original mistakes preserved';
  assert (result->'card'->>'review_count')::integer=8;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform public.replace_practice_answer(current_setting('replacement_test.answer')::uuid,gen_random_uuid(),1,true);
    raise exception 'anonymous replacement accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
