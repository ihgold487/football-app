-- Run this once in the football-app Supabase project's SQL Editor.
-- ESPN's short school/team names make the Results-table headers compact.

alter table public.games
  add column if not exists away_short_name text,
  add column if not exists home_short_name text;
