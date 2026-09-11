import { isSupabaseConfigured, supabase } from "./supabase";

const toNumber = (spread) => {
  const value = Number(String(spread ?? "").replace("−", "-"));
  return Number.isFinite(value) ? value : null;
};

export async function loadPublishedWeek() {
  if (!isSupabaseConfigured) return null;
  const { data: week, error: weekError } = await supabase
    .from("pick_weeks")
    .select("id, season, week_number, title, lock_at, tiebreaker_game_id")
    .not("published_at", "is", null)
    .gte("lock_at", new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString())
    .order("lock_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (weekError) throw weekError;
  if (!week) return null;
  const { data: links, error: linkError } = await supabase
    .from("week_games")
    .select("games(id, league, kickoff_at, away_team, home_team, away_score, home_score, home_spread, status)")
    .eq("week_id", week.id);
  if (linkError) throw linkError;
  return {
    ...week,
    games: (links ?? []).map(({ games }) => ({
      id: games.id, league: games.league === "nfl" ? "NFL" : "NCAA", kickoff: new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(games.kickoff_at)),
      away: games.away_team, home: games.home_team, awaySpread: games.home_spread === null ? "—" : (games.home_spread > 0 ? `−${games.home_spread}` : `+${Math.abs(games.home_spread)}`),
      homeSpread: games.home_spread === null ? "—" : (games.home_spread > 0 ? `+${games.home_spread}` : `−${Math.abs(games.home_spread)}`), status: games.status,
    })),
  };
}

export async function savePick(weekId, gameId, side) {
  const { error } = await supabase.rpc("save_pick", { target_week_id: weekId, target_game_id: gameId, next_side: side });
  if (error) throw error;
}

export async function saveTiebreaker(weekId, totalPoints) {
  const { error } = await supabase.rpc("save_tiebreaker", { target_week_id: weekId, next_total_points: Number(totalPoints) });
  if (error) throw error;
}

export async function loadUserApprovals() {
  const { data: approvals, error: approvalError } = await supabase
    .from("app_user_approvals")
    .select("user_id, email, status, created_at, approved_at")
    .order("created_at", { ascending: true });
  if (approvalError) throw approvalError;

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, display_name");
  if (profileError) throw profileError;

  const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.display_name]));
  return (approvals ?? []).map((approval) => ({ ...approval, display_name: names.get(approval.user_id) ?? approval.email }));
}

export async function updateUserApproval(userId, status, approvedBy) {
  const { error } = await supabase
    .from("app_user_approvals")
    .update({
      status,
      approved_at: status === "approved" ? new Date().toISOString() : null,
      approved_by: status === "approved" ? approvedBy : null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw error;
}

export async function publishWeek({ season, weekNumber, title, lockAt, games, tiebreakerGameId }) {
  const { data: week, error: weekError } = await supabase.from("pick_weeks").upsert({
    season, week_number: weekNumber, title, lock_at: lockAt, tiebreaker_game_id: tiebreakerGameId, published_at: new Date().toISOString(),
  }, { onConflict: "season,week_number" }).select("id").single();
  if (weekError) throw weekError;
  const gameRows = games.map((game) => ({ provider: "espn", provider_game_id: game.id, league: game.league === "NFL" ? "nfl" : "ncaa_fbs", season, week_number: weekNumber, kickoff_at: game.kickoffAt ?? new Date().toISOString(), away_team: game.away, home_team: game.home, home_spread: toNumber(game.homeSpread), status: "scheduled" }));
  const { data: storedGames, error: gameError } = await supabase.from("games").upsert(gameRows, { onConflict: "provider,provider_game_id" }).select("id");
  if (gameError) throw gameError;
  const { error: removeError } = await supabase.from("week_games").delete().eq("week_id", week.id);
  if (removeError) throw removeError;
  const { error: mapError } = await supabase.from("week_games").insert(storedGames.map((game) => ({ week_id: week.id, game_id: game.id })));
  if (mapError) throw mapError;
  return week.id;
}
