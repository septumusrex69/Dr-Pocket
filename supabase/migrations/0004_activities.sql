-- More than one activity per entry, plus a free-text "how long / how far" (16 Nov 2026).
-- entries.activity is kept (as the activities joined with ", ") so older code and reports still read it.
alter table public.entries
  add column activities text[] not null default '{}',
  add column activity_detail text not null default '' check (length(activity_detail) <= 300);
update public.entries set activities = array[activity] where activity <> '' and activities = '{}';

create or replace function public.keep_entry_history() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if (old.body, old.pain, old.at, old.symptoms, old.activities, old.activity_detail, old.triggers, old.relief, old.impact)
     is distinct from (new.body, new.pain, new.at, new.symptoms, new.activities, new.activity_detail, new.triggers, new.relief, new.impact) then
    new.edits := old.edits || jsonb_build_array(jsonb_build_object(
      'saved_at', coalesce(old.updated_at, old.created_at), 'body', old.body, 'pain', old.pain, 'at', old.at,
      'symptoms', old.symptoms, 'activities', old.activities, 'activity_detail', old.activity_detail,
      'triggers', old.triggers, 'relief', old.relief, 'impact', old.impact));
    new.updated_at := now();
  end if;
  return new;
end $$;
