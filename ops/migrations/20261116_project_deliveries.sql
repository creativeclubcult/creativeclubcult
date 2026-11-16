-- A project's deliveries: drafts and the final files, each with a due day and the day it went out.
-- The team reads them; owners and admins (private.can_edit) add, change and remove them. Every change is written to
-- sync_changes, so it shows in the project's History. The old projects.deliver_by becomes a "Final files" delivery.

create table public.project_deliveries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 60),
  due_on date,
  sent_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index project_deliveries_project on public.project_deliveries (project_id);

alter table public.project_deliveries enable row level security;

create policy "Team reads deliveries" on public.project_deliveries for select to authenticated using (private.is_team());
create policy "Editors add deliveries" on public.project_deliveries for insert to authenticated with check (private.can_edit());
create policy "Editors change deliveries" on public.project_deliveries for update to authenticated using (private.can_edit()) with check (private.can_edit());
create policy "Editors remove deliveries" on public.project_deliveries for delete to authenticated using (private.can_edit());

revoke all on public.project_deliveries from anon, authenticated;
grant select, delete on public.project_deliveries to authenticated;
grant insert (project_id, label, due_on, sent_on) on public.project_deliveries to authenticated;
grant update (label, due_on, sent_on) on public.project_deliveries to authenticated;

create trigger project_deliveries_stamp before insert or update on public.project_deliveries
  for each row execute function private.stamp_row();

-- History: "Delivery: empty to Draft 1, due 2026-11-18", "Delivery: Draft 1, due 2026-11-18 to Draft 1, sent 2026-11-18"
create or replace function private.log_delivery()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  uid uuid := (select auth.uid());
  r public.project_deliveries := coalesce(new, old);
  said text;
  was text;
  lbl text;
begin
  if uid is null then return null; end if;
  if tg_op <> 'DELETE' then
    said := new.label || coalesce(', due ' || new.due_on::text, '') || coalesce(', sent ' || new.sent_on::text, '');
  end if;
  if tg_op <> 'INSERT' then
    was := old.label || coalesce(', due ' || old.due_on::text, '') || coalesce(', sent ' || old.sent_on::text, '');
  end if;
  if said is not distinct from was then return null; end if;
  select left(coalesce(p.tab_name, p.plan_title), 200) into lbl from public.projects p where p.id = r.project_id;
  insert into public.sync_changes (source, actor_id, actor_email, entity, entity_id, label, field, old_value, new_value)
  values ('admin', uid, left((select auth.jwt()) ->> 'email', 254), 'project', r.project_id, lbl, 'delivery', to_jsonb(was), to_jsonb(said));
  return null;
end;
$$;
revoke all on function private.log_delivery() from public, anon, authenticated;

create trigger project_deliveries_log after insert or update or delete on public.project_deliveries
  for each row execute function private.log_delivery();

-- the one deliver by date each project had becomes its Final files delivery (sent once the files were delivered)
insert into public.project_deliveries (project_id, label, due_on, sent_on)
select id, 'Final files', deliver_by, case when final_file_date <= (now() at time zone 'Asia/Jakarta')::date then final_file_date end
  from public.projects where deliver_by is not null;
