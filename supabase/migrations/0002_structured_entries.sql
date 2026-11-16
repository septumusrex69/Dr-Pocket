-- Structured fields from the Dr Pocket brand + app guide (16 Nov 2026), section 07 "Data model & trust rules".
-- The original note text (entries.body) is never changed by these; they sit beside it.

-- A clinician-confirmed diagnosis is kept apart from the person's own description.
alter table public.problems add column diagnosis text not null default '';
alter table public.problems drop constraint problems_status_check;
alter table public.problems add constraint problems_status_check check (status in ('active','improving','resolved','archived'));

-- entries.at is when it happened (occurred_at); entries.created_at is when it was written down (recorded_at).
alter table public.entries
  add column time_known boolean not null default true,   -- false: only the day is known, never shown as a time
  add column symptoms text[] not null default '{}',        -- e.g. {Pain,Stiffness}
  add column activity text not null default '',            -- what you were doing
  add column triggers text not null default '',
  add column relief text not null default '',              -- what helped
  add column impact text not null default '',              -- what it stopped you doing
  add column updated_at timestamptz,
  add column edits jsonb not null default '[]';            -- earlier versions, newest last

-- Edit history: keep the previous version whenever the words, pain, time or fields change.
create or replace function public.keep_entry_history() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (old.body, old.pain, old.at, old.symptoms, old.activity, old.triggers, old.relief, old.impact)
     is distinct from (new.body, new.pain, new.at, new.symptoms, new.activity, new.triggers, new.relief, new.impact) then
    new.edits := old.edits || jsonb_build_array(jsonb_build_object(
      'saved_at', coalesce(old.updated_at, old.created_at), 'body', old.body, 'pain', old.pain, 'at', old.at,
      'symptoms', old.symptoms, 'activity', old.activity, 'triggers', old.triggers, 'relief', old.relief, 'impact', old.impact));
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger entries_history before update on public.entries for each row execute function public.keep_entry_history();
