-- Run this once in the football-app Supabase project's SQL Editor.
-- It lets approved group members read everyone's picks and tiebreakers only
-- after the database-clock pick deadline has passed.

begin;

drop policy if exists "users read own picks" on public.picks;
drop policy if exists "users read own tiebreaker" on public.week_tiebreakers;

create policy "picks visible after lock" on public.picks for select using (
  public.is_approved_user() and (
    user_id = auth.uid()
    or public.is_app_owner()
    or exists (select 1 from public.pick_weeks where id = week_id and now() >= lock_at)
  )
);

create policy "tiebreakers visible after lock" on public.week_tiebreakers for select using (
  public.is_approved_user() and (
    user_id = auth.uid()
    or public.is_app_owner()
    or exists (select 1 from public.pick_weeks where id = week_id and now() >= lock_at)
  )
);

commit;
