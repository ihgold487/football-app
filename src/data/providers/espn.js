const ESPN_FBS_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard";

function numberToSpread(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value > 0 ? `+${value}` : String(value).replace("-", "−");
}

function parseSpread(competition, homeTeam) {
  const detail = competition.odds?.[0]?.details;
  if (!detail) return { homeSpread: "—", awaySpread: "—", spreadDetail: "Line unavailable" };
  const value = Number(detail.match(/([−-]?\d+(?:\.\d+)?)\s*$/)?.[1]?.replace("−", "-"));
  if (Number.isNaN(value)) return { homeSpread: "—", awaySpread: "—", spreadDetail: detail };
  const homeNamed = detail.toLowerCase().startsWith(homeTeam.toLowerCase());
  const homeValue = homeNamed ? value : -value;
  return { homeSpread: numberToSpread(homeValue), awaySpread: numberToSpread(-homeValue), spreadDetail: detail };
}

export async function loadEspnFbsGames(date) {
  const query = new URLSearchParams({ dates: date.replaceAll("-", ""), groups: "80", limit: "300" });
  const response = await fetch(`${ESPN_FBS_SCOREBOARD}?${query}`);
  if (!response.ok) throw new Error(`ESPN returned ${response.status}.`);
  const data = await response.json();

  return (data.events || []).flatMap((event) => {
    const competition = event.competitions?.[0];
    const competitors = competition?.competitors || [];
    const home = competitors.find((team) => team.homeAway === "home");
    const away = competitors.find((team) => team.homeAway === "away");
    if (!home || !away) return [];
    const line = parseSpread(competition, home.team.displayName);
    return [{
      id: `espn-${event.id}`,
      league: "NCAA",
      kickoff: new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(event.date)),
      away: away.team.displayName,
      home: home.team.displayName,
      awaySpread: line.awaySpread,
      homeSpread: line.homeSpread,
      spreadDetail: line.spreadDetail,
    }];
  });
}
