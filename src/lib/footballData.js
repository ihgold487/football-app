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
    .select("games(id, provider_game_id, league, kickoff_at, away_team, home_team, away_short_name, home_short_name, away_score, home_score, home_spread, status)")
    .eq("week_id", week.id);
  if (linkError) throw linkError;
  return {
    ...week,
    games: (links ?? []).map(({ games }) => ({
      id: games.id, providerGameId: games.provider_game_id, league: games.league === "nfl" ? "NFL" : "NCAA", kickoffAt: games.kickoff_at, kickoff: new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(games.kickoff_at)),
      away: games.away_team, home: games.home_team, awayShortName: games.away_short_name ?? games.away_team, homeShortName: games.home_short_name ?? games.home_team, awaySpread: games.home_spread === null ? "—" : (games.home_spread > 0 ? `−${games.home_spread}` : `+${Math.abs(games.home_spread)}`),
      homeSpread: games.home_spread === null ? "—" : (games.home_spread > 0 ? `+${games.home_spread}` : `−${Math.abs(games.home_spread)}`), status: games.status,
    })).sort((left, right) => (left.league === right.league ? 0 : left.league === "NCAA" ? -1 : 1)),
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

export async function loadWeekResults(weekId, userId = null) {
  const picksQuery = supabase.from("picks").select("id, user_id, game_id, selected_side").eq("week_id", weekId);
  if (userId) picksQuery.eq("user_id", userId);
  const [{ data: picks, error: pickError }, { data: profiles, error: profileError }, { data: pickResults, error: resultError }, { data: tiebreakers, error: tiebreakerError }] = await Promise.all([
    picksQuery,
    supabase.from("profiles").select("user_id, display_name"),
    supabase.from("pick_results").select("pick_id, outcome, points_awarded"),
    supabase.from("week_tiebreakers").select("user_id, predicted_total_points").eq("week_id", weekId),
  ]);
  if (pickError) throw pickError;
  if (profileError) throw profileError;
  if (resultError) throw resultError;
  if (tiebreakerError) throw tiebreakerError;

  const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.display_name]));
  const resultsByPick = new Map((pickResults ?? []).map((result) => [result.pick_id, result]));
  const tiebreakersByUser = new Map((tiebreakers ?? []).map((tiebreaker) => [tiebreaker.user_id, tiebreaker.predicted_total_points]));
  const rows = new Map();
  for (const pick of picks ?? []) {
    if (!rows.has(pick.user_id)) rows.set(pick.user_id, { userId: pick.user_id, displayName: names.get(pick.user_id) ?? "Player", picks: {}, correct: 0, points: 0, tiebreaker: tiebreakersByUser.get(pick.user_id) ?? null });
    const row = rows.get(pick.user_id);
    const result = resultsByPick.get(pick.id);
    row.picks[pick.game_id] = { side: pick.selected_side, outcome: result?.outcome ?? "pending", points: Number(result?.points_awarded ?? 0) };
    if (result?.outcome === "win") row.correct += 1;
    row.points += Number(result?.points_awarded ?? 0);
  }
  return [...rows.values()].sort((left, right) => right.points - left.points || left.displayName.localeCompare(right.displayName));
}

export async function publishWeek({ season, weekNumber, title, lockAt, lockRule, games, tiebreakerGameId }) {
  const { data: week, error: weekError } = await supabase.from("pick_weeks").upsert({
    season, week_number: weekNumber, title, lock_at: lockAt, lock_rule: lockRule, tiebreaker_game_id: null, published_at: new Date().toISOString(),
  }, { onConflict: "season,week_number" }).select("id").single();
  if (weekError) throw weekError;
  const gameRows = games.map((game) => ({ provider: "espn", provider_game_id: game.id, league: game.league === "NFL" ? "nfl" : "ncaa_fbs", season, week_number: weekNumber, kickoff_at: game.kickoffAt ?? new Date().toISOString(), away_team: game.away, home_team: game.home, away_short_name: game.awayShortName ?? game.away, home_short_name: game.homeShortName ?? game.home, home_spread: toNumber(game.homeSpread), status: "scheduled" }));
  const { data: storedGames, error: gameError } = await supabase.from("games").upsert(gameRows, { onConflict: "provider,provider_game_id" }).select("id, provider_game_id");
  if (gameError) throw gameError;
  const { error: removeError } = await supabase.from("week_games").delete().eq("week_id", week.id);
  if (removeError) throw removeError;
  const { error: mapError } = await supabase.from("week_games").insert(storedGames.map((game) => ({ week_id: week.id, game_id: game.id })));
  if (mapError) throw mapError;
  const tiebreakerId = storedGames.find((game) => game.provider_game_id === tiebreakerGameId)?.id ?? null;
  const { error: tiebreakerError } = await supabase.from("pick_weeks").update({ tiebreaker_game_id: tiebreakerId }).eq("id", week.id);
  if (tiebreakerError) throw tiebreakerError;
  const idsByProviderGameId = new Map(storedGames.map((game) => [game.provider_game_id, game.id]));
  return {
    id: week.id,
    season,
    week_number: weekNumber,
    title,
    lock_at: lockAt,
    tiebreaker_game_id: tiebreakerId,
    // The browser uses database UUIDs for save_pick(), while the importer
    // uses ESPN IDs. Return the UUID-mapped game list immediately after
    // publishing so users do not have to reload before making picks.
    games: games.map((game) => ({ ...game, id: idsByProviderGameId.get(game.id) ?? game.id })),
  };
}
