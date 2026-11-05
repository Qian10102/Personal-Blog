-- Run against an authorized test account; every change is rolled back.
begin;
select set_config('review_test.owner',id::text,true) from auth.users where lower(email)='qianzihanduo@gmail.com' limit 1;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('review_test.owner'),'email','qianzihanduo@gmail.com','role','authenticated')::text,true);
set local role authenticated;
do $$
declare
  initial jsonb:=public.get_review_planner();
  rev bigint:=coalesce((initial->>'revision')::bigint,0);
  request_id uuid:=gen_random_uuid();
  document jsonb:='{"settings":{"timezone":"UTC"},"courses":[{"id":"c","subject":"数学"}],"adjustments":[],"exams":[{"id":"e","subject":"数学","scope":"第一章"}],"tasks":[{"id":"t","examId":"e","minutes":50,"phase":"learn"}],"windows":[],"exceptions":[]}';
  result jsonb;
  plan jsonb;
  session jsonb:='{"id":"review-sql-test-session","taskId":"t","examId":"e","subject":"数学","title":"第一章","content":"概念梳理","phase":"learn","start":"2026-11-03T08:00:00.000Z","end":"2026-11-03T08:50:00.000Z","minutes":50}';
begin
  -- These tests also work when the user already has a planner: preserve its
  -- existing completions in the temporary test snapshot.
  result:=public.save_review_planner(request_id,rev,document);
  assert (result->>'revision')::bigint=rev+1,'save must return the new revision';
  result:=public.save_review_planner(request_id,rev,document);
  assert (result->>'revision')::bigint=rev+1,'retry must not add a revision';
  begin
    perform public.save_review_planner(request_id,rev,document||'{"changed":true}');
    raise exception 'mismatched retry accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_review_planner(gen_random_uuid(),rev,document);
    raise exception 'stale revision accepted';
  exception when serialization_failure then null; end;
  plan:=jsonb_build_object('id',gen_random_uuid(),'document',document,'generatedAt',now(),'sessions',
    coalesce((select jsonb_agg(c->'session') from jsonb_array_elements(coalesce(initial->'completions','[]')) c),'[]')||jsonb_build_array(session),'gaps','[]'::jsonb,'availableMinutes',100);
  result:=public.save_review_planner(gen_random_uuid(),rev+1,document,plan);
  assert result->'plan'->>'id'=plan->>'id','plan confirmation is atomic';
  result:=public.save_review_planner(gen_random_uuid(),rev+2,document,null,'{"sessionId":"review-sql-test-session","completed":true}');
  assert exists(select 1 from jsonb_array_elements(result->'completions') c where c->'session'=session),'completion uses server-side session snapshot';
  begin
    perform public.save_review_planner(gen_random_uuid(),rev+3,document,plan||jsonb_build_object('id',gen_random_uuid(),'sessions','[]'::jsonb));
    raise exception 'lost completion accepted';
  exception when invalid_parameter_value then null; end;
  assert (public.get_review_planner()->>'revision')::bigint=rev+3,'failed plan must roll back all writes';
  begin
    perform public.save_review_planner(gen_random_uuid(),rev+3,document,null,'{"sessionId":"fabricated","completed":true}');
    raise exception 'fabricated completion accepted';
  exception when invalid_parameter_value then null; end;
  result:=public.save_review_planner(gen_random_uuid(),rev+3,document,plan||jsonb_build_object('id',gen_random_uuid()));
  assert exists(select 1 from jsonb_array_elements(result->'completions') c where c->'session'=session),'replan must keep completed records';
  begin
    update public.review_planners set revision=999 where user_id=auth.uid();
    raise exception 'direct write accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform * from private.review_planner_writes;
    raise exception 'receipts exposed';
  exception when insufficient_privilege then null; end;
end;
$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('review_test.owner'),'email','other@example.test','role','authenticated')::text,true);
do $$
begin
  assert public.get_review_planner() is null,'unauthorized email can read data';
  begin
    perform public.save_review_planner(gen_random_uuid(),0,'{}'::jsonb);
    raise exception 'unauthorized email can write';
  exception when insufficient_privilege then null; end;
end;
$$;
set local role anon;
do $$
begin
  begin perform public.get_review_planner(); raise exception 'anonymous RPC accepted'; exception when insufficient_privilege then null; end;
  begin perform * from public.review_planners; raise exception 'anonymous table read accepted'; exception when insufficient_privilege then null; end;
end;
$$;
rollback;
