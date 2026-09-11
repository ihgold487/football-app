import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, CircleAlert, ClipboardCheck, LockKeyhole, Settings, Trophy } from "lucide-react";
import { demoGames, demoWeek } from "./data/demoSlate";
import { loadEspnFbsGames } from "./data/providers/espn";
import { getApprovalStatus, getSession, onAuthChange, signIn, signUp } from "./lib/auth";
import { loadPublishedWeek, publishWeek, savePick, saveTiebreaker } from "./lib/footballData";
import { isSupabaseConfigured } from "./lib/supabase";

const LOCAL_PICKS_KEY = "saturday-slate-demo-picks-v1";
const LOCAL_SLATE_KEY = "saturday-slate-local-slate-v1";
const WOLVERINE_HELMET = `${import.meta.env.BASE_URL}icons/icon-512.png`;
const LIONS_HELMET = `${import.meta.env.BASE_URL}helmets/lions-helmet-silver.png`;
const loadLocal = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };

function SignInScreen() {
  const [mode, setMode] = useState("sign-in"); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [displayName, setDisplayName] = useState(""); const [message, setMessage] = useState(""); const [working, setWorking] = useState(false);
  async function submit(event) { event.preventDefault(); setWorking(true); setMessage(""); try { if (mode === "sign-in") await signIn(email, password); else { await signUp(email, password, displayName); setMessage("Account created. Check your email if confirmation is required, then wait for approval."); } } catch (error) { setMessage(error.message); } finally { setWorking(false); } }
  return <main className="app-shell auth-shell"><div className="brand"><span aria-hidden="true" className="helmet-morph"><img className="helmet-wolverine" src={WOLVERINE_HELMET} /><img className="helmet-lions" src={LIONS_HELMET} /></span><span>Saturday Slate</span></div><section className="auth-card"><p className="eyebrow">PRIVATE PICKS GROUP</p><h1>{mode === "sign-in" ? "Welcome back" : "Request access"}</h1><p>Sign in to make picks and follow the weekly slate.</p><form onSubmit={submit}>{mode === "sign-up" && <label>Display name<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>}<label>Email<input autoComplete="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength="8" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{message && <p className="notice"><CircleAlert size={18} />{message}</p>}<button className="save-button" disabled={working} type="submit">{working ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}</button></form><button className="auth-switch" onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")} type="button">{mode === "sign-in" ? "Need an account? Request access" : "Already approved? Sign in"}</button></section></main>;
}

function GameCard({ game, selection, onPick }) {
  const choices = [{ team: game.away, spread: game.awaySpread, side: "away" }, { team: game.home, spread: game.homeSpread, side: "home" }];
  return <article className="game-card"><div className="game-meta"><span>{game.league}</span><span>{game.kickoff}{game.spreadDetail ? ` · ${game.spreadDetail}` : ""}</span></div><div className="game-teams">{choices.map((choice) => {
    const selected = selection === choice.side;
    return <button aria-pressed={selected} className={`pick-option ${selected ? "is-selected" : ""}`} key={choice.side} onClick={() => onPick(game.id, choice.side)} type="button"><span>{choice.team}</span><strong>{choice.spread}</strong>{selected && <Check aria-label="Selected" size={18} strokeWidth={3} />}</button>;
  })}</div></article>;
}

function AdminPage({ onPublish }) {
  const saved = loadLocal(LOCAL_SLATE_KEY, { games: demoGames, selectedIds: demoGames.map((game) => game.id) });
  const [availableGames, setAvailableGames] = useState(saved.games);
  const [selectedIds, setSelectedIds] = useState(saved.selectedIds);
  const [slateDate, setSlateDate] = useState("2026-09-12");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  async function importFbsGames() {
    setLoading(true); setMessage("");
    try { const games = await loadEspnFbsGames(slateDate); if (!games.length) throw new Error("No FBS games were returned for that date."); setAvailableGames(games); setSelectedIds([]); setMessage(`${games.length} FBS games loaded. Check the games you want in this week's slate.`); }
    catch (error) { setMessage(`Could not load ESPN data: ${error.message}`); } finally { setLoading(false); }
  }
  const toggleGame = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((gameId) => gameId !== id) : [...current, id]);
  function publishSlate() {
    const selectedGames = availableGames.filter((game) => selectedIds.includes(game.id));
    if (!selectedGames.length) { setMessage("Choose at least one NCAA game before publishing."); return; }
    localStorage.setItem(LOCAL_SLATE_KEY, JSON.stringify({ games: selectedGames, selectedIds: selectedGames.map((game) => game.id) }));
    onPublish(selectedGames);
  }
  return <>
    <section className="week-header"><div><p className="eyebrow">ADMINISTRATION</p><h1>Set the slate</h1></div><div className="score-chip"><Settings size={17} /><span>Admin</span></div></section>
    <section className="admin-intro"><strong>Week 2 · NCAA games</strong><p>Load the FBS schedule, select the games to include, then publish the slate for picks.</p></section>
    <section className="import-panel"><div><label htmlFor="slate-date">FBS game date</label><input id="slate-date" type="date" value={slateDate} onChange={(event) => setSlateDate(event.target.value)} /></div><button disabled={loading} onClick={importFbsGames} type="button">{loading ? "Loading…" : "Load ESPN FBS games"}</button></section>
    <section className="selection-heading"><div><h2>Choose games</h2><p>ESPN is a free, experimental source for this prototype.</p></div><span className="pick-count">{selectedIds.length} selected</span></section>
    <section className="admin-games" aria-label="Available FBS games">{availableGames.map((game) => <label className="admin-game" key={game.id}><input checked={selectedIds.includes(game.id)} onChange={() => toggleGame(game.id)} type="checkbox" /><span><strong>{game.away} <em>{game.awaySpread}</em> at {game.home} <em>{game.homeSpread}</em></strong><small>{game.kickoff} · {game.spreadDetail || "Spread unavailable"}</small></span></label>)}</section>
    {message && <p className="notice"><CircleAlert size={18} />{message}</p>}
    <button className="save-button" onClick={publishSlate} type="button"><ClipboardCheck size={18} />Publish {selectedIds.length || ""} games to Picks</button><p className="demo-note">Development preview · the published slate is saved only on this device</p>
  </>;
}

function PicksPage({ games, picks, setPicks, totalPoints, setTotalPoints, notice, setNotice, cloudWeekId }) {
  const pickedCount = Object.keys(picks).filter((id) => games.some((game) => game.id === id)).length;
  const missing = games.length - pickedCount;
  const formattedLock = useMemo(() => new Intl.DateTimeFormat("en-US", { weekday: "long", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(demoWeek.lockAt)), []);
  const pickGame = (gameId, side) => { setPicks((current) => ({ ...current, [gameId]: side })); setNotice(""); };
  const savePicks = async () => {
    if (missing) { setNotice(`${missing} ${missing === 1 ? "game is" : "games are"} still blank. You can change picks until the lock, but blank picks receive zero points.`); return; }
    if (cloudWeekId) { try { await Promise.all(Object.entries(picks).map(([gameId, side]) => savePick(cloudWeekId, gameId, side))); await saveTiebreaker(cloudWeekId, totalPoints); setNotice("Your picks are securely saved."); } catch (error) { setNotice(`Could not save your picks: ${error.message}`); } return; }
    setNotice("All picks are saved on this device. You can refresh the page to verify they remain here.");
  };
  return <>
    <section className="week-header"><div><p className="eyebrow">{demoWeek.season} FOOTBALL PICKS</p><h1>{demoWeek.label}</h1></div><div className="score-chip"><Trophy size={17} /><span>Standings</span></div></section>
    <section className="lock-banner" aria-label="Pick deadline"><LockKeyhole size={20} /><div><strong>Picks lock {formattedLock}</strong><span>One hour before the first included NCAA game</span></div></section>
    <section className="picks-heading"><div><h2>Make your picks</h2><p>Choose the team that covers the spread.</p></div><span className="pick-count">{pickedCount} / {games.length}</span></section>
    <section className="games" aria-label="Week 2 games">{games.map((game) => <GameCard game={game} key={game.id} selection={picks[game.id]} onPick={pickGame} />)}</section>
    <section className="tiebreaker"><div><p className="eyebrow">TIEBREAKER</p><h2>{demoWeek.tieBreaker}</h2><p>Predict the combined final score.</p></div><label><span className="sr-only">Total points prediction</span><input min="0" max="200" onChange={(event) => setTotalPoints(event.target.value)} type="number" value={totalPoints} /><span>PTS</span></label></section>
    {notice && <p className="notice"><CircleAlert size={18} />{notice}</p>}<button className="save-button" onClick={savePicks} type="button">Save {pickedCount ? "my picks" : "picks"}</button><p className="demo-note">Development preview · picks are saved only on this device</p>
  </>;
}

export default function App() {
  const localPicks = loadLocal(LOCAL_PICKS_KEY, { picks: {}, totalPoints: 47 });
  const localSlate = loadLocal(LOCAL_SLATE_KEY, { games: demoGames });
  const [page, setPage] = useState("picks");
  const [picks, setPicks] = useState(localPicks.picks);
  const [totalPoints, setTotalPoints] = useState(localPicks.totalPoints);
  const [games, setGames] = useState(localSlate.games);
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState(null);
  const [approval, setApproval] = useState(null);
  const [cloudWeekId, setCloudWeekId] = useState(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  useEffect(() => { localStorage.setItem(LOCAL_PICKS_KEY, JSON.stringify({ picks, totalPoints })); }, [picks, totalPoints]);
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    const update = async (nextSession) => { setSession(nextSession); setApproval(nextSession ? await getApprovalStatus() : null); setAuthReady(true); };
    getSession().then(update).catch(() => setAuthReady(true));
    return onAuthChange(update);
  }, []);
  useEffect(() => {
    if (!isSupabaseConfigured || approval?.status !== "approved") return;
    loadPublishedWeek().then((week) => { if (week) { setCloudWeekId(week.id); setGames(week.games); } }).catch((error) => setNotice(`Could not load the shared slate: ${error.message}`));
  }, [approval]);
  async function publishGames(nextGames) {
    if (isSupabaseConfigured) {
      try { const weekId = await publishWeek({ season: demoWeek.season, weekNumber: 2, title: demoWeek.label, lockAt: demoWeek.lockAt, games: nextGames, tiebreakerGameId: null }); setCloudWeekId(weekId); setNotice("The slate is published for approved users."); }
      catch (error) { setNotice(`Could not publish the slate: ${error.message}`); return; }
    } else { localStorage.setItem(LOCAL_SLATE_KEY, JSON.stringify({ games: nextGames, selectedIds: nextGames.map((game) => game.id) })); setNotice("Your new slate is ready for local pick testing."); }
    setGames(nextGames); setPicks({}); setPage("picks");
  }
  if (!authReady) return <main className="app-shell"><p className="demo-note">Checking your account…</p></main>;
  if (isSupabaseConfigured && !session) return <SignInScreen />;
  if (isSupabaseConfigured && approval?.status !== "approved") return <main className="app-shell auth-shell"><section className="auth-card"><p className="eyebrow">ACCESS PENDING</p><h1>Your account is waiting for approval.</h1><p>You’ll be able to make picks after the group administrator approves your request.</p></section></main>;
  return <main className="app-shell"><header className="topbar"><div className="brand"><span aria-hidden="true" className="helmet-morph"><img className="helmet-wolverine" src={WOLVERINE_HELMET} /><img className="helmet-lions" src={LIONS_HELMET} /></span><span>Saturday Slate</span></div><button className="profile-button" type="button" aria-label="Open account menu">IG <ChevronDown size={15} /></button></header><nav className="page-nav" aria-label="Main navigation"><button className={page === "picks" ? "active" : ""} onClick={() => setPage("picks")} type="button">Picks</button>{(!isSupabaseConfigured || approval?.is_owner) && <button className={page === "admin" ? "active" : ""} onClick={() => setPage("admin")} type="button">Admin</button>}</nav>{page === "admin" ? <AdminPage onPublish={publishGames} /> : <PicksPage games={games} picks={picks} setPicks={setPicks} totalPoints={totalPoints} setTotalPoints={setTotalPoints} notice={notice} setNotice={setNotice} cloudWeekId={cloudWeekId} />}</main>;
}
