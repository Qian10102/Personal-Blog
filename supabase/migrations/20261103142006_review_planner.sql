begin;

-- The editable inputs live together so an edit can be committed atomically.
-- Published plan snapshots and completion snapshots survive subsequent edits.
create table public.review_planners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0,
  document jsonb not null,
  current_plan_id uuid,
  updated_at timestamptz not null default now()
);
create table public.review_plan_versions (
  user_id uuid not null references public.review_planners(user_id) on delete cascade,
  id uuid not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,id)
);
alter table public.review_planners add constraint review_current_plan_fk
  foreign key(user_id,current_plan_id) references public.review_plan_versions(user_id,id) deferrable initially deferred;
create table public.review_completions (
  user_id uuid not null references public.review_planners(user_id) on delete cascade,
  session_id text not null,
  session jsonb not null,
  completed_at timestamptz not null default now(),
  primary key(user_id,session_id)
);
create table private.review_planner_writes (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  payload_hash text not null,
  primary key(user_id,request_id)
);

alter table public.review_planners enable row level security;
alter table public.review_plan_versions enable row level security;
alter table public.review_completions enable row level security;
alter table private.review_planner_writes enable row level security;
revoke all on public.review_planners,public.review_plan_versions,public.review_completions from public,anon,authenticated;
revoke all on private.review_planner_writes from public,anon,authenticated;
grant select on public.review_planners,public.review_plan_versions,public.review_completions to authenticated;
create policy "owner reads review inputs" on public.review_planners for select to authenticated
  using ((select auth.uid())=user_id and lower(coalesce((select auth.jwt())->>'email',''))='qianzihanduo@gmail.com');
create policy "owner reads review plans" on public.review_plan_versions for select to authenticated
  using ((select auth.uid())=user_id and lower(coalesce((select auth.jwt())->>'email',''))='qianzihanduo@gmail.com');
create policy "owner reads review completions" on public.review_completions for select to authenticated
  using ((select auth.uid())=user_id and lower(coalesce((select auth.jwt())->>'email',''))='qianzihanduo@gmail.com');

create function public.get_review_planner() returns jsonb
language sql volatile security invoker set search_path='' as $$
  select jsonb_build_object('revision',p.revision,'document',p.document,'plan',v.snapshot,
    'completions',coalesce((select jsonb_agg(jsonb_build_object('session',c.session,'completedAt',c.completed_at) order by c.session_id)
      from public.review_completions c where c.user_id=p.user_id),'[]'::jsonb))
  from public.review_planners p left join public.review_plan_versions v on v.user_id=p.user_id and v.id=p.current_plan_id
  where p.user_id=(select auth.uid());
$$;
revoke all on function public.get_review_planner() from public,anon;
grant execute on function public.get_review_planner() to authenticated;

create function private.save_review_planner(
  p_request_id uuid,p_expected_revision bigint,p_document jsonb,p_plan jsonb,p_completion jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid:=auth.uid();
  current_row public.review_planners;
  payload text:=md5(jsonb_build_array(p_expected_revision,p_document,p_plan,p_completion)::text);
  receipt text;
  new_plan_id uuid;
  item jsonb;
  session_record jsonb;
  completed_session record;
begin
  if owner_id is null or lower(coalesce(auth.jwt()->>'email',''))<>'qianzihanduo@gmail.com' then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  if p_request_id is null or p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid request' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text||':review-planner',0));
  select payload_hash into receipt from private.review_planner_writes where user_id=owner_id and request_id=p_request_id;
  if found then
    if receipt<>payload then raise exception 'Request ID reused with different payload' using errcode='22023'; end if;
    return public.get_review_planner();
  end if;
  select * into current_row from public.review_planners where user_id=owner_id for update;
  if coalesce(current_row.revision,0)<>p_expected_revision then raise exception 'Stale revision' using errcode='40001'; end if;
  if p_document is null or jsonb_typeof(p_document)<>'object' or octet_length(p_document::text)>1048576
    or jsonb_typeof(p_document->'settings') is distinct from 'object' then raise exception 'Invalid document' using errcode='22023'; end if;
  foreach receipt in array array['courses','adjustments','exams','tasks','windows','exceptions'] loop
    if jsonb_typeof(p_document->receipt) is distinct from 'array' or jsonb_array_length(p_document->receipt)>2000 then
      raise exception 'Invalid input list' using errcode='22023';
    end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_document->'settings'->>'timezone') then raise exception 'Invalid timezone' using errcode='22023'; end if;
  -- No missing task references or repeated entity identifiers.
  for item in select value from jsonb_array_elements(p_document->'exams') loop
    if length(trim(coalesce(item->>'scope',''))) not between 1 and 12000
      or not exists(select 1 from jsonb_array_elements(p_document->'courses') c where c->>'subject'=item->>'subject') then
      raise exception 'Invalid exam' using errcode='22023';
    end if;
  end loop;
  for item in select value from jsonb_array_elements(p_document->'tasks') loop
    if not exists(select 1 from jsonb_array_elements(p_document->'exams') e where e->>'id'=item->>'examId')
      or (item->>'minutes')::integer not between 25 and 6000 or (item->>'minutes')::integer%25<>0
      or item->>'phase' not in ('learn','practice','recap') then raise exception 'Invalid task' using errcode='22023'; end if;
  end loop;
  if not exists(select 1 from public.review_planners where user_id=owner_id) then
    insert into public.review_planners(user_id,document) values(owner_id,p_document);
  end if;
  if p_plan is not null and p_completion is not null then raise exception 'Only one operation per save' using errcode='22023'; end if;
  if p_plan is not null then
    if jsonb_typeof(p_plan) is distinct from 'object' or p_plan->'document' is distinct from p_document
      or jsonb_typeof(p_plan->'sessions') is distinct from 'array' or jsonb_array_length(p_plan->'sessions')>15000
      or octet_length(p_plan::text)>16777216 then raise exception 'Invalid plan snapshot' using errcode='22023'; end if;
    new_plan_id:=(p_plan->>'id')::uuid;
    if new_plan_id is null then raise exception 'Missing plan ID' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(p_plan->'sessions') s group by s->>'id' having count(*)>1) then
      raise exception 'Duplicate sessions' using errcode='22023';
    end if;
    for completed_session in select session_id,session from public.review_completions where user_id=owner_id loop
      if not exists(select 1 from jsonb_array_elements(p_plan->'sessions') s where s=completed_session.session) then
        raise exception 'Completed sessions must be preserved' using errcode='22023';
      end if;
    end loop;
    insert into public.review_plan_versions(user_id,id,snapshot) values(owner_id,new_plan_id,p_plan);
  end if;
  if p_completion is not null then
    if jsonb_typeof(p_completion->'completed') is distinct from 'boolean' or p_completion->>'sessionId' is null then raise exception 'Invalid completion' using errcode='22023'; end if;
    select s into session_record from public.review_plan_versions v cross join lateral jsonb_array_elements(v.snapshot->'sessions') s
      where v.user_id=owner_id and v.id=current_row.current_plan_id and s->>'id'=p_completion->>'sessionId';
    if session_record is null then raise exception 'Session not found in current plan' using errcode='22023'; end if;
    if (p_completion->>'completed')::boolean then
      insert into public.review_completions(user_id,session_id,session) values(owner_id,p_completion->>'sessionId',session_record) on conflict do nothing;
    else
      delete from public.review_completions where user_id=owner_id and session_id=p_completion->>'sessionId';
    end if;
  end if;
  update public.review_planners set document=p_document,revision=p_expected_revision+1,
    current_plan_id=coalesce(new_plan_id,current_plan_id),updated_at=clock_timestamp() where user_id=owner_id;
  insert into private.review_planner_writes values(owner_id,p_request_id,payload);
  return public.get_review_planner();
end;
$$;
revoke all on function private.save_review_planner(uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.save_review_planner(uuid,bigint,jsonb,jsonb,jsonb) to authenticated;
create function public.save_review_planner(p_request_id uuid,p_expected_revision bigint,p_document jsonb,p_plan jsonb default null,p_completion jsonb default null)
returns jsonb language sql security invoker set search_path='' as $$
  select private.save_review_planner(p_request_id,p_expected_revision,p_document,p_plan,p_completion);
$$;
revoke all on function public.save_review_planner(uuid,bigint,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.save_review_planner(uuid,bigint,jsonb,jsonb,jsonb) to authenticated;
commit;
