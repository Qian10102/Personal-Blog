-- Verify every published verb is accepted by both modes, then roll back.
begin;
do $$
declare owner uuid;
begin
  select id into owner from auth.users where lower(email)='qianzihanduo@gmail.com' limit 1;
  assert owner is not null;
  perform set_config('request.jwt.claims',json_build_object('sub',owner,'email','qianzihanduo@gmail.com')::text,true);
  assert (select count(*) from private.french_practice_verbs)=142;
  perform set_config('b2_test.verbs',(select jsonb_agg(infinitive)::text from private.french_practice_verbs),true);
end $$;
set local role authenticated;
do $$
declare verb_name text; result jsonb; attempt uuid;
begin
  for verb_name in select jsonb_array_elements_text(current_setting('b2_test.verbs')::jsonb) loop
    result := public.record_practice_answer(gen_random_uuid(),'meaning',true,verb_name);
    assert result->'progress'->>'verb'=verb_name;
    result := public.record_practice_answer(gen_random_uuid(),'conjugation',true,verb_name,'subjonctif',5);
    assert result->'progress'->>'verb'=verb_name;
  end loop;
  attempt := gen_random_uuid();
  result := public.record_practice_answer(attempt,'meaning',false,'se prononcer');
  result := public.replace_practice_answer(attempt,gen_random_uuid(),0,true);
  assert result->'progress'->>'verb'='se prononcer';
  perform * from public.record_verb_meaning_answer(gen_random_uuid(),'soutenir',true);
  perform * from public.record_conjugation_answer(gen_random_uuid(),'soutenir','futur',true);
  begin
    perform public.record_practice_answer(gen_random_uuid(),'meaning',true,'unknown');
    raise exception 'unknown meaning accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_practice_answer(gen_random_uuid(),'conjugation',true,'unknown','present',0);
    raise exception 'unknown conjugation accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform * from public.record_conjugation_answer(gen_random_uuid(),'unknown','present',true);
    raise exception 'unknown legacy conjugation accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform * from public.record_verb_meaning_answer(gen_random_uuid(),'unknown',true);
    raise exception 'unknown legacy meaning accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform * from private.french_practice_verbs;
    raise exception 'private allowlist readable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
