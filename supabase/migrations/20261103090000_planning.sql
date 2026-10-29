-- Dogcare — planning engine
-- The app proposes how to split a request among the people who said "Oui"
-- (computed in the app, src/domain/planner.ts); the owner validates it and
-- every slice is confirmed at once, or none (confirm_plan). Each slice goes
-- through confirm_assignment: same checks (caretaker, "Oui" covering the
-- slice, guest dates, no overlap) and same notifications.
-- Owner rules per dog: maximum consecutive nights per helper, minimum slice.

alter table public.dogs
  add column plan_max_nights smallint not null default 3 check (plan_max_nights between 1 and 14),
  add column plan_min_slice_hours smallint not null default 3 check (plan_min_slice_hours between 1 and 12);

grant update (plan_max_nights, plan_min_slice_hours) on public.dogs to authenticated;

-- p_slices: [{"user_id": uuid, "starts_at": timestamptz, "ends_at": timestamptz}, …]
create function public.confirm_plan(p_request_id uuid, p_slices jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slice jsonb;
  v_count integer := 0;
begin
  if p_slices is null or jsonb_typeof(p_slices) <> 'array' or jsonb_array_length(p_slices) = 0 then
    raise exception 'Le planning est vide.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_slices) > 50 then
    raise exception 'Ce planning a trop de tranches.' using errcode = 'P0001';
  end if;
  for v_slice in select * from jsonb_array_elements(p_slices) loop
    if jsonb_typeof(v_slice) <> 'object'
       or private.try_uuid(v_slice ->> 'user_id') is null
       or (v_slice ->> 'starts_at') is null or (v_slice ->> 'ends_at') is null then
      raise exception 'Tranche de planning invalide.' using errcode = 'P0001';
    end if;
    -- any failure (changed answer, overlap…) cancels the whole plan
    perform public.confirm_assignment(
      p_request_id,
      private.try_uuid(v_slice ->> 'user_id'),
      (v_slice ->> 'starts_at')::timestamptz,
      (v_slice ->> 'ends_at')::timestamptz
    );
    v_count := v_count + 1;
  end loop;
  perform private.audit('plan_confirmed', (select group_id from public.care_requests where id = p_request_id), p_request_id,
    jsonb_build_object('slices', v_count));
  return v_count;
end;
$$;

revoke all on function public.confirm_plan(uuid, jsonb) from public, anon;
grant execute on function public.confirm_plan(uuid, jsonb) to authenticated;
