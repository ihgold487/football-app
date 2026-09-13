-- Run this once in the football-app Supabase project's SQL Editor.
-- It allows only the app owner to save ESPN final scores and grade picks.

begin;

drop policy if exists "owner manages results" on public.pick_results;

create policy "owner manages results" on public.pick_results for all
  using (public.is_app_owner())
  with check (public.is_app_owner());

commit;
