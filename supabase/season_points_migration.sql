-- Run this once in the football-app Supabase project's SQL Editor.
-- It adds the weekly entry amount and the season-points ledger.

begin;

alter table public.pick_weeks
  add column if not exists entry_fee numeric(8,2) not null default 5 check (entry_fee >= 0);

create table if not exists public.season_point_ledger (
  id uuid primary key default gen_random_uuid(),
  season integer not null check (season between 2020 and 2100),
  week_id uuid references public.pick_weeks(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(8,2) not null check (amount <> 0),
  entry_type text not null check (entry_type in ('entry_fee', 'award', 'adjustment')),
  description text,
  created_at timestamptz not null default now(),
  unique (week_id, user_id, entry_type)
);

alter table public.season_point_ledger enable row level security;

drop policy if exists "approved users read season points" on public.season_point_ledger;
create policy "approved users read season points" on public.season_point_ledger
  for select using (public.is_approved_user());

drop policy if exists "owner manages season points" on public.season_point_ledger;
create policy "owner manages season points" on public.season_point_ledger
  for all using (public.is_app_owner()) with check (public.is_app_owner());

create or replace function public.save_pick(
  target_week_id uuid, target_game_id uuid, next_side text
) returns void language plpgsql security definer set search_path = public as $$
declare
  current_lock timestamptz;
  weekly_entry_fee numeric(8,2);
  weekly_season integer;
begin
  if not public.is_approved_user() then raise exception 'Not approved.'; end if;
  if next_side not in ('away', 'home') then raise exception 'Invalid pick side.'; end if;
  select lock_at, entry_fee, season into current_lock, weekly_entry_fee, weekly_season
    from public.pick_weeks where id = target_week_id;
  if current_lock is null then raise exception 'Unknown pick week.'; end if;
  if now() >= current_lock then raise exception 'Picks are locked.'; end if;
  if not exists (select 1 from public.week_games where week_id = target_week_id and game_id = target_game_id) then
    raise exception 'Game is not included in this week.';
  end if;
  if weekly_entry_fee > 0 then
    insert into public.season_point_ledger (season, week_id, user_id, amount, entry_type, description)
    values (weekly_season, target_week_id, auth.uid(), -weekly_entry_fee, 'entry_fee', 'Weekly entry')
    on conflict (week_id, user_id, entry_type) do nothing;
  end if;
  insert into public.picks (week_id, game_id, user_id, selected_side)
  values (target_week_id, target_game_id, auth.uid(), next_side)
  on conflict (week_id, game_id, user_id) do update set selected_side = excluded.selected_side, selected_at = now();
end;
$$;

create or replace function public.get_season_point_totals(target_season integer)
returns table (user_id uuid, display_name text, total_points numeric)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.display_name, coalesce(sum(l.amount), 0)::numeric as total_points
  from public.profiles p
  join public.app_user_approvals a on a.user_id = p.user_id
  left join public.season_point_ledger l on l.user_id = p.user_id and l.season = target_season
  where public.is_approved_user()
    and (a.status = 'approved' or p.user_id = auth.uid())
  group by p.user_id, p.display_name
  order by total_points desc, p.display_name asc;
$$;

grant execute on function public.get_season_point_totals(integer) to authenticated;
commit;
