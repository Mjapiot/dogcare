-- Dogcare — "Planifier une absence" in one transaction
-- The request and its proposals are created together: the "new request"
-- notice of a person who gets a proposal is replaced before anything is
-- committed, so a push dispatch running at the same time can never send it
-- (it used to be possible between the two steps). Either both exist or none.

create function public.plan_absence(
  p_group_id uuid,
  p_dog_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_description text,
  p_proposals jsonb
)
returns uuid
language plpgsql
-- runs as the caller: the request insert goes through RLS and its triggers
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.care_requests (group_id, dog_id, request_type, necessity, starts_at, ends_at, description, splittable)
  values (p_group_id, p_dog_id, 'care', 'required', p_starts_at, p_ends_at, nullif(btrim(p_description), ''), true)
  returning id into v_id;
  if p_proposals is not null and jsonb_typeof(p_proposals) = 'array' and jsonb_array_length(p_proposals) > 0 then
    perform public.send_proposals(v_id, p_proposals);
  end if;
  return v_id;
end;
$$;

revoke all on function public.plan_absence(uuid, uuid, timestamptz, timestamptz, text, jsonb) from public, anon;
grant execute on function public.plan_absence(uuid, uuid, timestamptz, timestamptz, text, jsonb) to authenticated;
