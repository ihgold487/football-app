-- Saturday Slate: initial schema. Apply this only to a dedicated football-app
-- Supabase project; it is intentionally unrelated to workout-app.

begin;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_user_approvals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pick_weeks (
  id uuid primary key default gen_random_uuid(),
  season integer not null check (season between 2020 and 2100),
  week_number integer not null check (week_number between 1 and 30),
  title text not null,
  lock_rule text not null default 'first_ncaa_game_minus_60'
    check (lock_rule in ('first_ncaa_game_minus_60', 'custom')),
  lock_at timestamptz not null,
  entry_fee numeric(8,2) not null default 5 check (entry_fee >= 0),
  tiebreaker_game_id uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season, week_number)
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_game_id text not null,
  league text not null check (league in ('ncaa_fbs', 'nfl')),
  season integer not null,
  week_number integer not null,
  kickoff_at timestamptz not null,
  away_team text not null,
  home_team text not null,
  away_short_name text,
  home_short_name text,
  -- Positive means the home team is receiving points; half-point values are preferred.
  home_spread numeric(4,1),
  away_score integer,
  home_score integer,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'final', 'postponed', 'canceled')),
  updated_at timestamptz not null default now(),
  unique (provider, provider_game_id)
);

create table public.week_games (
  week_id uuid not null references public.pick_weeks(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete restrict,
  included_at timestamptz not null default now(),
  primary key (week_id, game_id)
);

alter table public.pick_weeks
  add constraint pick_weeks_tiebreaker_game_fk
  foreign key (tiebreaker_game_id) references public.games(id) on delete set null;

create table public.picks (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references public.pick_weeks(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  selected_side text not null check (selected_side in ('away', 'home')),
  selected_at timestamptz not null default now(),
  unique (week_id, game_id, user_id)
);

create table public.week_tiebreakers (
  week_id uuid not null references public.pick_weeks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  predicted_total_points integer not null check (predicted_total_points between 0 and 200),
  updated_at timestamptz not null default now(),
  primary key (week_id, user_id)
);

create table public.pick_results (
  pick_id uuid primary key references public.picks(id) on delete cascade,
  outcome text not null check (outcome in ('win', 'loss', 'push', 'void')),
  points_awarded numeric(3,1) not null default 0,
  graded_at timestamptz not null default now()
);

-- A signed ledger keeps the season total auditable. Entry fees are negative;
-- prize awards will be positive once their distribution rules are defined.
create table public.season_point_ledger (
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

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create or replace function public.is_app_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and lower(email) = 'ihgold@comcast.net'
  );
$$;

create or replace function public.is_approved_user()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_app_owner() or exists (
    select 1 from public.app_user_approvals
    where user_id = auth.uid() and status = 'approved'
  );
$$;

create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), new.email))
  on conflict (user_id) do nothing;
  insert into public.app_user_approvals (user_id, email, status, approved_at)
  values (new.id, new.email,
    case when lower(new.email) = 'ihgold@comcast.net' then 'approved' else 'pending' end,
    case when lower(new.email) = 'ihgold@comcast.net' then now() else null end)
  on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute procedure public.create_profile_for_auth_user();

-- The client may only upsert a pick through this function. The deadline is
-- checked on the database clock, so changing device time cannot bypass it.
create or replace function public.save_pick(
  target_week_id uuid, target_game_id uuid, next_side text
) returns void language plpgsql security definer set search_path = public as $$
declare current_lock timestamptz;
declare weekly_entry_fee numeric(8,2);
declare weekly_season integer;
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

create or replace function public.save_tiebreaker(
  target_week_id uuid, next_total_points integer
) returns void language plpgsql security definer set search_path = public as $$
declare current_lock timestamptz;
begin
  if not public.is_approved_user() then raise exception 'Not approved.'; end if;
  select lock_at into current_lock from public.pick_weeks where id = target_week_id;
  if current_lock is null then raise exception 'Unknown pick week.'; end if;
  if now() >= current_lock then raise exception 'Picks are locked.'; end if;
  if next_total_points < 0 or next_total_points > 200 then raise exception 'Invalid total.'; end if;
  insert into public.week_tiebreakers (week_id, user_id, predicted_total_points)
  values (target_week_id, auth.uid(), next_total_points)
  on conflict (week_id, user_id) do update set
    predicted_total_points = excluded.predicted_total_points,
    updated_at = now();
end;
$$;

create or replace function public.get_my_app_approval_status()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'status', case when public.is_app_owner() then 'approved'
      else coalesce((select status from public.app_user_approvals where user_id = auth.uid()), 'pending') end,
    'is_owner', public.is_app_owner()
  );
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

alter table public.profiles enable row level security;
alter table public.app_user_approvals enable row level security;
alter table public.pick_weeks enable row level security;
alter table public.games enable row level security;
alter table public.week_games enable row level security;
alter table public.picks enable row level security;
alter table public.week_tiebreakers enable row level security;
alter table public.pick_results enable row level security;
alter table public.season_point_ledger enable row level security;

create policy "approved users read profiles" on public.profiles for select using (public.is_approved_user());
create policy "users read approval" on public.app_user_approvals for select using (user_id = auth.uid() or public.is_app_owner());
create policy "approved users read weeks" on public.pick_weeks for select using (public.is_approved_user());
create policy "approved users read games" on public.games for select using (public.is_approved_user());
create policy "approved users read week games" on public.week_games for select using (public.is_approved_user());
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
create policy "approved users read results" on public.pick_results for select using (public.is_approved_user());
create policy "owner manages results" on public.pick_results for all using (public.is_app_owner()) with check (public.is_app_owner());
create policy "owner manages weeks" on public.pick_weeks for all using (public.is_app_owner()) with check (public.is_app_owner());
create policy "owner manages games" on public.games for all using (public.is_app_owner()) with check (public.is_app_owner());
create policy "owner manages week games" on public.week_games for all using (public.is_app_owner()) with check (public.is_app_owner());
create policy "owner manages approvals" on public.app_user_approvals for all using (public.is_app_owner()) with check (public.is_app_owner());
create policy "approved users read season points" on public.season_point_ledger for select using (public.is_approved_user());
create policy "owner manages season points" on public.season_point_ledger for all using (public.is_app_owner()) with check (public.is_app_owner());

grant execute on function public.save_pick(uuid, uuid, text) to authenticated;
grant execute on function public.save_tiebreaker(uuid, integer) to authenticated;
grant execute on function public.get_my_app_approval_status() to authenticated;
grant execute on function public.get_season_point_totals(integer) to authenticated;
commit;
