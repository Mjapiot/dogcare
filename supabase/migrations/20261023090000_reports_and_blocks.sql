-- Dogcare — reporting content and blocking members (App Store guideline 1.2)
-- - Any member can report a request, a dog or a member of their group: the
--   report is stored (reviewed by the Dogcare team) and the group's admins
--   are notified.
-- - Any member can block another member: from then on, neither sees the
--   other's requests nor gets notified by the other's actions. Requests on
--   which the viewer already has a live assignment stay visible, so a
--   confirmed commitment never disappears silently.

alter type public.notification_type add value if not exists 'content_reported';

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------
create table public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon, authenticated;
grant select, delete on public.user_blocks to authenticated;
-- one sees (and can lift) only one's own blocks; creating one goes through block_member
create policy "user_blocks: read own" on public.user_blocks
  for select to authenticated using (blocker_id = (select auth.uid()));
create policy "user_blocks: unblock own" on public.user_blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));

-- true when either user blocked the other
create function private.is_blocked_pair(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b)
       or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

-- the current user may see this request: member of its group, and no block
-- with its author unless they already have a live assignment on it
create function private.request_visible(p_request_id uuid, p_group_id uuid, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_group_member(p_group_id)
    and (
      not private.is_blocked_pair((select auth.uid()), p_created_by)
      or exists (
        select 1 from public.care_assignments a
        where a.request_id = p_request_id
          and a.assigned_user_id = (select auth.uid())
          and a.status <> 'cancelled'
      )
    );
$$;

drop policy "care_requests: members read" on public.care_requests;
create policy "care_requests: members read" on public.care_requests
  for select to authenticated using (private.request_visible(id, group_id, created_by));

create or replace function private.can_access_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.care_requests r
    where r.id = p_request_id and private.request_visible(r.id, r.group_id, r.created_by)
  );
$$;

-- blocked members cannot answer each other's requests
create or replace function private.can_respond(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.care_requests r
    join public.group_members gm on gm.group_id = r.group_id and gm.user_id = (select auth.uid())
    where r.id = p_request_id
      and r.lifecycle_status = 'active'
      and r.necessity <> 'info'
      and r.ends_at > now()
      and not private.is_blocked_pair((select auth.uid()), r.created_by)
      and not exists (
        select 1 from public.dog_caretakers dc
        where dc.dog_id = r.dog_id and dc.user_id = (select auth.uid())
      )
  );
$$;

-- no notification between blocked members (same body as before, plus the check)
create or replace function private.notify(
  p_user_id uuid,
  p_group_id uuid,
  p_type public.notification_type,
  p_title text,
  p_body text,
  p_request_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  if p_user_id is null or p_user_id is not distinct from p_actor_id then
    return;
  end if;
  if private.is_blocked_pair(p_user_id, p_actor_id) then
    return;
  end if;

  select case p_type
           when 'new_request' then np.new_requests_enabled
           when 'response_reset' then np.new_requests_enabled
           when 'new_volunteer' then np.responses_enabled
           when 'assignment_confirmed' then np.confirmations_enabled
           when 'reconfirmation_needed' then np.confirmations_enabled
           when 'request_updated' then np.confirmations_enabled
           when 'assignment_cancelled' then np.cancellations_enabled
           when 'request_cancelled' then np.cancellations_enabled
           else true
         end
    into v_enabled
  from public.notification_preferences np
  where np.user_id = p_user_id;

  insert into public.notifications (user_id, group_id, notification_type, title, body, request_id, actor_id, push_state)
  values (p_user_id, p_group_id, p_type, p_title, p_body, p_request_id, p_actor_id,
          case when v_enabled is false then 'skipped' else 'pending' end);
end;
$$;

-- block a member of one of one's groups (idempotent)
create function public.block_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  if p_user_id is null or p_user_id = v_uid then
    raise exception 'Vous ne pouvez pas vous bloquer vous-même.' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.group_members a
    join public.group_members b on b.group_id = a.group_id
    where a.user_id = v_uid and b.user_id = p_user_id
  ) then
    raise exception 'Ce membre ne fait partie d''aucun de vos groupes.' using errcode = 'P0001';
  end if;
  insert into public.user_blocks (blocker_id, blocked_id) values (v_uid, p_user_id)
  on conflict do nothing;
  perform private.audit('member_blocked', null, p_user_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users (id) on delete set null,
  group_id uuid references public.groups (id) on delete set null,
  target_type text not null check (target_type in ('request', 'dog', 'member')),
  target_id uuid not null,
  reason text check (char_length(reason) <= 500),
  status text not null default 'open' check (status in ('open', 'reviewed')),
  created_at timestamptz not null default now()
);

create index content_reports_created_idx on public.content_reports (created_at);
create index content_reports_reporter_idx on public.content_reports (reporter_id);
create index content_reports_group_idx on public.content_reports (group_id);

alter table public.content_reports enable row level security;
revoke all on public.content_reports from anon, authenticated;
-- no policy: written through report_content, read by the Dogcare team only

create function public.report_content(p_group_id uuid, p_target_type text, p_target_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_what text;
  v_admin record;
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté.' using errcode = 'P0001';
  end if;
  if not private.is_group_member(p_group_id) then
    raise exception 'Vous ne faites pas partie de ce groupe.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.content_reports c
      where c.reporter_id = v_uid and c.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Trop de signalements. Réessayez plus tard.' using errcode = 'P0001';
  end if;

  case p_target_type
    when 'request' then
      select 'une demande pour ' || d.name into v_what
      from public.care_requests r join public.dogs d on d.id = r.dog_id
      where r.id = p_target_id and r.group_id = p_group_id;
    when 'dog' then
      select 'la fiche de ' || d.name into v_what
      from public.group_dogs gd join public.dogs d on d.id = gd.dog_id
      where gd.dog_id = p_target_id and gd.group_id = p_group_id;
    when 'member' then
      select private.display_name(m.user_id) into v_what
      from public.group_members m
      where m.user_id = p_target_id and m.group_id = p_group_id and m.user_id <> v_uid;
    else
      v_what := null;
  end case;
  if v_what is null then
    raise exception 'Élément introuvable dans ce groupe.' using errcode = 'P0001';
  end if;

  insert into public.content_reports (reporter_id, group_id, target_type, target_id, reason)
  values (v_uid, p_group_id, p_target_type, p_target_id, nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_id;
  perform private.audit('content_reported', p_group_id, null);

  -- the group's admins are told what was reported, not by whom
  for v_admin in
    select m.user_id from public.group_members m
    where m.group_id = p_group_id and m.role = 'admin' and m.user_id <> v_uid
  loop
    perform private.notify(v_admin.user_id, p_group_id, 'content_reported',
      'Signalement : ' || v_what,
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Un membre a signalé ce contenu.'),
      case when p_target_type = 'request' then p_target_id end,
      null);
  end loop;
  return v_id;
end;
$$;

-- private helpers are called by RLS policies as the signed-in user (schema not exposed by the API)
revoke all on function private.is_blocked_pair(uuid, uuid) from public, anon;
revoke all on function private.request_visible(uuid, uuid, uuid) from public, anon;
grant execute on function private.is_blocked_pair(uuid, uuid) to authenticated;
grant execute on function private.request_visible(uuid, uuid, uuid) to authenticated;
revoke all on function public.block_member(uuid) from public, anon;
revoke all on function public.report_content(uuid, text, uuid, text) from public, anon;
grant execute on function public.block_member(uuid) to authenticated;
grant execute on function public.report_content(uuid, text, uuid, text) to authenticated;
