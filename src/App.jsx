import { useMemo, useState } from "react";
import { Check, ChevronDown, CircleAlert, LockKeyhole, Trophy } from "lucide-react";
import { demoGames, demoWeek } from "./data/demoSlate";

function GameCard({ game, selection, onPick }) {
  const choices = [
    { team: game.away, spread: game.awaySpread, side: "away" },
    { team: game.home, spread: game.homeSpread, side: "home" },
  ];

  return (
    <article className="game-card">
      <div className="game-meta">
        <span>{game.league}</span>
        <span>{game.kickoff}</span>
      </div>
      <div className="game-teams">
        {choices.map((choice) => {
          const selected = selection === choice.side;
          return (
            <button
              aria-pressed={selected}
              className={`pick-option ${selected ? "is-selected" : ""}`}
              key={choice.side}
              onClick={() => onPick(game.id, choice.side)}
              type="button"
            >
              <span>{choice.team}</span>
              <strong>{choice.spread}</strong>
              {selected && <Check aria-label="Selected" size={18} strokeWidth={3} />}
            </button>
          );
        })}
      </div>
    </article>
  );
}

export default function App() {
  const [picks, setPicks] = useState({});
  const [totalPoints, setTotalPoints] = useState(47);
  const [notice, setNotice] = useState("");
  const pickedCount = Object.keys(picks).length;
  const missing = demoGames.length - pickedCount;
  const formattedLock = useMemo(
    () => new Intl.DateTimeFormat("en-US", { weekday: "long", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(demoWeek.lockAt)),
    []
  );

  function pickGame(gameId, side) {
    setPicks((current) => ({ ...current, [gameId]: side }));
    setNotice("");
  }

  function savePicks() {
    if (missing) {
      setNotice(`${missing} ${missing === 1 ? "game is" : "games are"} still blank. You can change picks until the lock, but blank picks receive zero points.`);
      return;
    }
    setNotice("All picks are ready. Supabase saving will be connected in the next increment.");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S</span><span>Saturday Slate</span></div>
        <button className="profile-button" type="button" aria-label="Open account menu">IG <ChevronDown size={15} /></button>
      </header>

      <section className="week-header">
        <div>
          <p className="eyebrow">{demoWeek.season} FOOTBALL PICKS</p>
          <h1>{demoWeek.label}</h1>
        </div>
        <div className="score-chip"><Trophy size={17} /> <span>Standings</span></div>
      </section>

      <section className="lock-banner" aria-label="Pick deadline">
        <LockKeyhole size={20} />
        <div><strong>Picks lock {formattedLock}</strong><span>One hour before the first included NCAA game</span></div>
      </section>

      <section className="picks-heading">
        <div><h2>Make your picks</h2><p>Choose the team that covers the spread.</p></div>
        <span className="pick-count">{pickedCount} / {demoGames.length}</span>
      </section>

      <section className="games" aria-label="Week 1 games">
        {demoGames.map((game) => <GameCard game={game} key={game.id} selection={picks[game.id]} onPick={pickGame} />)}
      </section>

      <section className="tiebreaker">
        <div><p className="eyebrow">TIEBREAKER</p><h2>{demoWeek.tieBreaker}</h2><p>Predict the combined final score.</p></div>
        <label><span className="sr-only">Total points prediction</span><input min="0" max="200" onChange={(event) => setTotalPoints(event.target.value)} type="number" value={totalPoints} /><span>PTS</span></label>
      </section>

      {notice && <p className="notice"><CircleAlert size={18} />{notice}</p>}
      <button className="save-button" onClick={savePicks} type="button">Save {pickedCount ? "my picks" : "picks"}</button>
      <p className="demo-note">Development preview · sample games only</p>
    </main>
  );
}
