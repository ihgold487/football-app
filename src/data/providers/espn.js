const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football";

function numberToSpread(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value > 0 ? `+${value}` : String(value).replace("-", "−");
}

function parseSpread(competition, homeTeam) {
  const detail = competition.odds?.[0]?.details;
  if (!detail) return { homeSpread: "—", awaySpread: "—", spreadDetail: "Line unavailable" };
  const value = Number(detail.match(/([−-]?\d+(?:\.\d+)?)\s*$/)?.[1]?.replace("−", "-"));
  if (Number.isNaN(value)) return { homeSpread: "—", awaySpread: "—", spreadDetail: detail };
  // ESPN's odds string can start with a full name ("Detroit Lions -3.5")
  // or an abbreviation ("DET -3.5"). Matching both prevents treating every
  // abbreviated NFL home favorite as the road team.
  const detailStart = detail.trim().toLowerCase();
  const homeNames = [homeTeam.displayName, homeTeam.shortDisplayName, homeTeam.name, homeTeam.abbreviation]
    .filter(Boolean)
    .map((name) => name.toLowerCase());
  const homeNamed = homeNames.some((name) => detailStart.startsWith(name));
  const homeValue = homeNamed ? value : -value;
  return { homeSpread: numberToSpread(homeValue), awaySpread: numberToSpread(-homeValue), spreadDetail: detail };
}

function formatGame(event, league) {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors || [];
  const home = competitors.find((team) => team.homeAway === "home");
  const away = competitors.find((team) => team.homeAway === "away");
  if (!home || !away) return null;
  const line = parseSpread(competition, home.team);
  const withRank = (competitor) => {
    const rank = competitor.curatedRank?.current;
    return league === "NCAA" && Number.isInteger(rank) && rank >= 1 && rank <= 25
      ? `(${rank}) ${competitor.team.displayName}`
      : competitor.team.displayName;
  };
  return {
    id: `espn-${event.id}`,
    league,
    kickoffAt: event.date,
    kickoff: new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(event.date)),
    away: withRank(away),
    home: withRank(home),
    awaySpread: line.awaySpread,
    homeSpread: line.homeSpread,
    spreadDetail: line.spreadDetail,
  };
}

async function loadScoreboard(path, date, group) {
  const query = new URLSearchParams({ dates: date.replaceAll("-", ""), limit: "300" });
  if (group) query.set("groups", group);
  const response = await fetch(`${ESPN_SCOREBOARD}/${path}/scoreboard?${query}`);
  if (!response.ok) throw new Error(`ESPN returned ${response.status}.`);
  const data = await response.json();
  return data.events || [];
}

export async function loadEspnFbsGames(date) {
  const events = await loadScoreboard("college-football", date, "80");
  return events.map((event) => formatGame(event, "NCAA")).filter(Boolean);
}

function dateOffset(date, days) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

// A college-football slate normally centers on Saturday. NFL games for that
// same football week can start Thursday and finish Monday.
export async function loadEspnNflGames(saturdayDate) {
  const dates = [-2, -1, 0, 1, 2].map((offset) => dateOffset(saturdayDate, offset));
  const results = await Promise.all(dates.map((date) => loadScoreboard("nfl", date)));
  const seen = new Set();
  return results.flat().map((event) => formatGame(event, "NFL")).filter((game) => {
    if (!game || seen.has(game.id)) return false;
    seen.add(game.id);
    return true;
  }).sort((left, right) => new Date(left.kickoffAt) - new Date(right.kickoffAt));
}
