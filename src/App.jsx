import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, CircleAlert, ClipboardCheck, LockKeyhole, Settings, Trophy } from "lucide-react";
import { demoGames, demoWeek } from "./data/demoSlate";
import { loadEspnFbsGames, loadEspnLiveScores, loadEspnNflGames } from "./data/providers/espn";
import { getApprovalStatus, getSession, onAuthChange, signIn, signUp } from "./lib/auth";
import { loadPublishedWeek, loadUserApprovals, loadWeekResults, publishWeek, savePick, saveTiebreaker, updateUserApproval } from "./lib/footballData";
import { isSupabaseConfigured } from "./lib/supabase";

const LOCAL_PICKS_KEY = "saturday-slate-demo-picks-v1";
const LOCAL_SLATE_KEY = "saturday-slate-local-slate-v1";
const WOLVERINE_HELMET = `${import.meta.env.BASE_URL}icons/icon-512.png`;
const LIONS_HELMET = `${import.meta.env.BASE_URL}helmets/lions-helmet-silver.png`;
const OWNER_EMAIL = "ihgold@comcast.net";
const BUILD_TIME = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(__SATURDAY_SLATE_BUILD__));
const loadLocal = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };

function BuildStamp() {
  const [checking, setChecking] = useState(false);
  async function checkForUpdate() {
    setChecking(true);
    try {
      const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null;
      await registration?.update();
      // The PWA is configured for auto-update. Reload after checking so a
      // newly activated worker and its freshly cached bundle take effect.
      window.setTimeout(() => window.location.reload(), 900);
    } catch {
      window.location.reload();
    }
  }
  return <div className="build-stamp"><span>Build {BUILD_TIME}</span><button disabled={checking} onClick={checkForUpdate} type="button">{checking ? "Updating…" : "Check for update"}</button></div>;
}

function compactTeamName(fullName) {
  const name = String(fullName ?? "").replace(/^\(\d+\)\s*/, "");
  const multiWordMascots = /\s+(?:Golden Gophers|Horned Frogs|Ragin' Cajuns|Fighting Irish|Crimson Tide|Red Raiders|Blue Devils|Tar Heels|Wolf Pack|Nittany Lions|Mountaineers|Yellow Jackets|Green Wave|Rainbow Warriors)$/;
  if (multiWordMascots.test(name)) return name.replace(multiWordMascots, "");
  const words = name.split(/\s+/);
  return words.length > 1 ? words.slice(0, -1).join(" ") : name;
}

function resultHeaderTeam(game, side) {
  const fullName = game[side];
  const shortName = game[`${side}ShortName`];
  return shortName && shortName !== fullName ? shortName.replace(/^\(\d+\)\s*/, "") : compactTeamName(fullName);
}

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

function UserApprovals({ ownerId }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [changingUserId, setChangingUserId] = useState(null);
  const [message, setMessage] = useState("");
  const refreshUsers = async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    try { setUsers(await loadUserApprovals()); }
    catch (error) { setMessage(`Could not load users: ${error.message}`); }
    finally { setLoading(false); }
  };
  useEffect(() => { refreshUsers(); }, []);
  async function changeStatus(userId, status) {
    setChangingUserId(userId); setMessage("");
    try { await updateUserApproval(userId, status, ownerId); setUsers((current) => current.map((user) => user.user_id === userId ? { ...user, status } : user)); }
    catch (error) { setMessage(`Could not update access: ${error.message}`); }
    finally { setChangingUserId(null); }
  }
  if (!isSupabaseConfigured) return <section className="approval-panel"><div><p className="eyebrow">USER MANAGEMENT</p><h2>User approvals</h2><p>Connect Supabase to manage access for your group.</p></div></section>;
  return <section className="approval-panel"><div className="approval-heading"><div><p className="eyebrow">USER MANAGEMENT</p><h2>User approvals</h2><p>Approve friends after they confirm their email address.</p></div><button className="refresh-button" disabled={loading} onClick={refreshUsers} type="button">{loading ? "Loading…" : "Refresh"}</button></div>{message && <p className="notice"><CircleAlert size={18} />{message}</p>}{!loading && !users.length && <p className="empty-state">No accounts have requested access yet.</p>}<div className="approval-list">{users.map((user) => { const isOwner = user.user_id === ownerId; const isChanging = changingUserId === user.user_id; return <article className="approval-user" key={user.user_id}><div><strong>{user.display_name}</strong><span>{user.email}</span><small>{isOwner ? "App owner" : `Current status: ${user.status}`}</small></div>{isOwner ? <span className="owner-badge">Owner</span> : <div className="approval-actions"><button className={user.status === "approved" ? "selected" : ""} disabled={isChanging} onClick={() => changeStatus(user.user_id, "approved")} type="button">Approve</button><button className={user.status === "pending" ? "selected" : ""} disabled={isChanging} onClick={() => changeStatus(user.user_id, "pending")} type="button">Pending</button><button className={user.status === "denied" ? "selected deny" : "deny"} disabled={isChanging} onClick={() => changeStatus(user.user_id, "denied")} type="button">Deny</button></div>}</article>; })}</div></section>;
}

const toLocalDateTime = (date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

function AdminPage({ onPublish, ownerId }) {
  const saved = loadLocal(LOCAL_SLATE_KEY, { games: demoGames, selectedIds: demoGames.map((game) => game.id) });
  const [availableGames, setAvailableGames] = useState(saved.games);
  const [selectedIds, setSelectedIds] = useState(saved.selectedIds);
  const [slateDate, setSlateDate] = useState("2026-09-12");
  const [season, setSeason] = useState(2026);
  const [weekNumber, setWeekNumber] = useState(2);
  const [title, setTitle] = useState("Week 2");
  const [lockMode, setLockMode] = useState("automatic");
  const [customLockAt, setCustomLockAt] = useState("");
  const [tiebreakerId, setTiebreakerId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const selectedGames = availableGames.filter((game) => selectedIds.includes(game.id));
  const ncaaGames = availableGames.filter((game) => game.league === "NCAA");
  const nflGames = availableGames.filter((game) => game.league === "NFL");
  const earliestKickoff = selectedGames.reduce((earliest, game) => !game.kickoffAt || (earliest && new Date(earliest) <= new Date(game.kickoffAt)) ? earliest : game.kickoffAt, null);
  const automaticLockAt = earliestKickoff ? new Date(new Date(earliestKickoff).getTime() - 60 * 60 * 1000) : null;
  const effectiveLockAt = lockMode === "automatic" ? automaticLockAt?.toISOString() : customLockAt ? new Date(customLockAt).toISOString() : null;
  async function importFbsGames() {
    setLoading(true); setMessage("");
    try { const [fbsGames, nflGames] = await Promise.all([loadEspnFbsGames(slateDate), loadEspnNflGames(slateDate)]); if (!fbsGames.length && !nflGames.length) throw new Error("No FBS or NFL games were returned for that football week."); const games = [...fbsGames, ...nflGames]; setAvailableGames(games); setSelectedIds(nflGames.map((game) => game.id)); setTiebreakerId(nflGames.at(-1)?.id ?? null); setMessage(`${fbsGames.length} FBS games loaded. ${nflGames.length} NFL games are included automatically.`); }
    catch (error) { setMessage(`Could not load ESPN data: ${error.message}`); } finally { setLoading(false); }
  }
  const toggleGame = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((gameId) => gameId !== id) : [...current, id]);
  function publishSlate() {
    if (!selectedGames.length) { setMessage("Choose at least one NCAA game before publishing."); return; }
    if (!nflGames.length) { setMessage("Load the football week so every NFL game is included."); return; }
    if (!effectiveLockAt) { setMessage("Choose a valid lock time after loading the schedule."); return; }
    if (!tiebreakerId) { setMessage("Choose the final NFL game for the tiebreaker."); return; }
    localStorage.setItem(LOCAL_SLATE_KEY, JSON.stringify({ games: selectedGames, selectedIds: selectedGames.map((game) => game.id) }));
    onPublish({ season: Number(season), weekNumber: Number(weekNumber), title, lockAt: effectiveLockAt, lockRule: lockMode === "automatic" ? "first_ncaa_game_minus_60" : "custom", games: selectedGames, tiebreakerGameId: tiebreakerId });
  }
  return <>
    <section className="week-header"><div><p className="eyebrow">ADMINISTRATION</p><h1>Set the slate</h1></div><div className="score-chip"><Settings size={17} /><span>Admin</span></div></section>
    <section className="admin-intro"><strong>Choose NCAA · all NFL included</strong><p>Load one football week, select the FBS games to include, and set the final NFL-game tiebreaker.</p></section>
    <section className="week-settings"><label>Season<input min="2020" max="2100" onChange={(event) => setSeason(event.target.value)} type="number" value={season} /></label><label>Week<input min="1" max="30" onChange={(event) => { setWeekNumber(event.target.value); setTitle(`Week ${event.target.value}`); }} type="number" value={weekNumber} /></label><label className="week-title">Slate title<input onChange={(event) => setTitle(event.target.value)} value={title} /></label></section>
    <section className="import-panel"><div><label htmlFor="slate-date">NCAA Saturday</label><input id="slate-date" type="date" value={slateDate} onChange={(event) => setSlateDate(event.target.value)} /></div><button disabled={loading} onClick={importFbsGames} type="button">{loading ? "Loading…" : "Load NCAA + NFL schedule"}</button></section>
    <section className="deadline-panel"><div><p className="eyebrow">PICK DEADLINE</p><h2>{automaticLockAt ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(automaticLockAt) : "Load a schedule first"}</h2><p>Default: one hour before the earliest NCAA or NFL game you include.</p></div><label className="lock-choice"><input checked={lockMode === "automatic"} onChange={() => setLockMode("automatic")} type="radio" name="lock-mode" />Use default</label><label className="lock-choice"><input checked={lockMode === "custom"} onChange={() => setLockMode("custom")} type="radio" name="lock-mode" />Custom<input disabled={lockMode !== "custom"} onChange={(event) => setCustomLockAt(event.target.value)} type="datetime-local" value={customLockAt || (lockMode === "custom" && automaticLockAt ? toLocalDateTime(automaticLockAt) : "")} /></label></section>
    <section className="selection-heading"><div><h2>Choose NCAA games</h2><p>ESPN is a free, experimental source for this prototype.</p></div><span className="pick-count">{selectedGames.length} total</span></section>
    <section className="admin-games" aria-label="Available FBS games">{ncaaGames.map((game) => <label className="admin-game" key={game.id}><input checked={selectedIds.includes(game.id)} onChange={() => toggleGame(game.id)} type="checkbox" /><span><strong>{game.away} <em>{game.awaySpread}</em> at {game.home} <em>{game.homeSpread}</em></strong><small>{game.kickoff} · {game.spreadDetail || "Spread unavailable"}</small></span></label>)}</section>
    <section className="selection-heading"><div><h2>NFL games</h2><p>All games from Thursday through Monday are included automatically. Select the final game as the tiebreaker.</p></div><span className="pick-count">{nflGames.length} included</span></section>
    <section className="admin-games" aria-label="Included NFL games">{nflGames.map((game) => <label className="admin-game nfl-game" key={game.id}><input checked={tiebreakerId === game.id} name="tiebreaker" onChange={() => setTiebreakerId(game.id)} type="radio" /><span><strong>{game.away} <em>{game.awaySpread}</em> at {game.home} <em>{game.homeSpread}</em></strong><small>{game.kickoff} · {game.spreadDetail || "Spread unavailable"} {tiebreakerId === game.id ? "· Tiebreaker" : ""}</small></span></label>)}</section>
    {message && <p className="notice"><CircleAlert size={18} />{message}</p>}
    <button className="save-button" onClick={publishSlate} type="button"><ClipboardCheck size={18} />Publish {selectedIds.length || ""} games to Picks</button><p className="demo-note">Development preview · the published slate is saved only on this device</p>
    <UserApprovals ownerId={ownerId} />
  </>;
}

function PicksPage({ games, picks, setPicks, totalPoints, setTotalPoints, notice, setNotice, cloudWeek }) {
  const pickedCount = Object.keys(picks).filter((id) => games.some((game) => game.id === id)).length;
  const missing = games.length - pickedCount;
  const activeWeek = cloudWeek ?? demoWeek;
  const lockAt = activeWeek.lock_at ?? activeWeek.lockAt;
  const formattedLock = useMemo(() => new Intl.DateTimeFormat("en-US", { weekday: "long", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(lockAt)), [lockAt]);
  const pickGame = (gameId, side) => { setPicks((current) => ({ ...current, [gameId]: side })); setNotice(""); };
  const savePicks = async () => {
    if (missing) { setNotice(`${missing} ${missing === 1 ? "game is" : "games are"} still blank. You can change picks until the lock, but blank picks receive zero points.`); return; }
    if (cloudWeek?.id) { try { const currentGameIds = new Set(games.map((game) => game.id)); const picksToSave = Object.entries(picks).filter(([gameId]) => currentGameIds.has(gameId)); await Promise.all(picksToSave.map(([gameId, side]) => savePick(cloudWeek.id, gameId, side))); await saveTiebreaker(cloudWeek.id, totalPoints); setNotice("Your picks are securely saved."); } catch (error) { setNotice(`Could not save your picks: ${error.message}`); } return; }
    setNotice("All picks are saved on this device. You can refresh the page to verify they remain here.");
  };
  return <>
    <section className="week-header"><div><p className="eyebrow">{activeWeek.season} FOOTBALL PICKS</p><h1>{activeWeek.title ?? activeWeek.label}</h1></div><div className="score-chip"><Trophy size={17} /><span>Standings</span></div></section>
    <section className="lock-banner" aria-label="Pick deadline"><LockKeyhole size={20} /><div><strong>Picks lock {formattedLock}</strong><span>One hour before the earliest included game</span></div></section>
    <section className="picks-heading"><div><h2>Make your picks</h2><p>Choose the team that covers the spread.</p></div><span className="pick-count">{pickedCount} / {games.length}</span></section>
    <section className="games" aria-label="Week 2 games">{games.map((game) => <GameCard game={game} key={game.id} selection={picks[game.id]} onPick={pickGame} />)}</section>
    <section className="tiebreaker"><div><p className="eyebrow">TIEBREAKER</p><h2>{demoWeek.tieBreaker}</h2><p>Predict the combined final score.</p></div><label><span className="sr-only">Total points prediction</span><input min="0" max="200" onChange={(event) => setTotalPoints(event.target.value)} type="number" value={totalPoints} /><span>PTS</span></label></section>
    {notice && <p className="notice"><CircleAlert size={18} />{notice}</p>}<button className="save-button" onClick={savePicks} type="button">Save {pickedCount ? "my picks" : "picks"}</button><p className="demo-note">Development preview · picks are saved only on this device</p>
  </>;
}

function ScoresPage({ games }) {
  const [scores, setScores] = useState({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  async function refreshScores() {
    if (!games.length) { setLoading(false); return; }
    setLoading(true); setMessage("");
    try { setScores(await loadEspnLiveScores(games)); setUpdatedAt(new Date()); }
    catch (error) { setMessage(`Could not load live scores: ${error.message}`); }
    finally { setLoading(false); }
  }
  useEffect(() => { refreshScores(); const timer = window.setInterval(refreshScores, 60_000); return () => window.clearInterval(timer); }, [games]);
  const sections = ["NCAA", "NFL"].map((league) => ({ league, games: games.filter((game) => game.league === league) })).filter((section) => section.games.length);
  return <><section className="week-header"><div><p className="eyebrow">LIVE SCOREBOARD</p><h1>Scores</h1></div><div className="score-chip"><Trophy size={17} /><span>Live</span></div></section><section className="scores-intro"><div><h2>Included games</h2><p>{updatedAt ? `Updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(updatedAt)} · refreshes every minute` : "Loading ESPN scores…"}</p></div><button className="refresh-button" disabled={loading} onClick={refreshScores} type="button">{loading ? "Refreshing…" : "Refresh"}</button></section>{message && <p className="notice"><CircleAlert size={18} />{message}</p>}{sections.map((section) => <section className="score-section" key={section.league}><h2>{section.league}</h2><div className="score-list">{section.games.map((game) => { const score = scores[game.id]; const isLive = score?.state === "in"; const isFinal = score?.state === "post"; return <article className="score-card" key={game.id}><div className="score-meta"><span>{isLive ? "LIVE" : isFinal ? "FINAL" : game.kickoff}</span><span>{score?.detail ?? "Scheduled"}</span></div><div className="score-team"><strong>{game.away}</strong><b>{score?.awayScore ?? "—"}</b></div><div className="score-team"><strong>{game.home}</strong><b>{score?.homeScore ?? "—"}</b></div></article>; })}</div></section>)}</>;
}

function ResultsPage({ games, cloudWeek, viewerId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const lockAt = cloudWeek?.lock_at ?? cloudWeek?.lockAt;
  const isLocked = Boolean(lockAt && new Date() >= new Date(lockAt));
  const formattedLock = lockAt ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(lockAt)) : null;
  async function refreshResults() {
    if (!cloudWeek?.id || (!isLocked && !viewerId)) return;
    setLoading(true); setMessage("");
    try { setRows(await loadWeekResults(cloudWeek.id, isLocked ? null : viewerId)); }
    catch (error) { setMessage(`Could not load results: ${error.message}`); }
    finally { setLoading(false); }
  }
  useEffect(() => { refreshResults(); }, [cloudWeek?.id, isLocked, viewerId]);
  const outcomeLabel = (outcome) => ({ win: "W", loss: "L", push: "Push", void: "Void", pending: "Pending" }[outcome] ?? "Pending");
  if (!cloudWeek) return <><section className="week-header"><div><p className="eyebrow">WEEKLY RESULTS</p><h1>Results</h1></div><div className="score-chip"><Trophy size={17} /><span>Scores</span></div></section><section className="results-placeholder"><h2>No shared slate yet</h2><p>Publish a weekly slate to make its results available after the pick deadline.</p></section></>;
  return <><section className="week-header"><div><p className="eyebrow">WEEKLY RESULTS</p><h1>{cloudWeek.title}</h1></div><div className="score-chip">{isLocked ? <Trophy size={17} /> : <LockKeyhole size={17} />}<span>{isLocked ? `${rows.length} players` : "Private preview"}</span></div></section><section className="results-intro"><div><h2>{isLocked ? "Everyone’s picks" : "Your submitted picks"}</h2><p>{isLocked ? "Final games will receive a win, loss, push, or void and update the totals here." : `Only you can see this preview. Everyone else's picks remain private until ${formattedLock}.`}</p></div><button className="refresh-button" disabled={loading} onClick={refreshResults} type="button">{loading ? "Refreshing…" : "Refresh"}</button></section>{message && <p className="notice"><CircleAlert size={18} />{message}</p>}{!loading && !rows.length && <section className="results-placeholder"><h2>{isLocked ? "No saved picks" : "No submitted picks yet"}</h2><p>{isLocked ? "No one submitted a pick for this slate before it locked." : "Save your picks from the Picks page to see your private preview here."}</p></section>}<div className="results-scroll"><table className="results-table"><thead><tr><th>Player</th><th className="correct-header">Correct</th>{games.map((game) => <th key={game.id}><span>{game.league}</span><b>{resultHeaderTeam(game, "away")}</b><i>@</i><b>{resultHeaderTeam(game, "home")}</b></th>)}<th>TB</th><th>Pts</th></tr></thead><tbody>{rows.map((row) => <tr key={row.userId}><th>{row.displayName}</th><td className="correct-cell">{row.correct}</td>{games.map((game) => { const pick = row.picks[game.id]; const team = pick ? resultHeaderTeam(game, pick.side) : "—"; return <td className={pick ? `result-cell ${pick.outcome}` : "result-cell"} key={game.id}>{pick ? <><strong>{team}</strong><span className={`result-status ${pick.outcome}`}>{outcomeLabel(pick.outcome)}</span></> : <span className="no-pick">—</span>}</td>; })}<td>{row.tiebreaker ?? "—"}</td><td className="points-cell">{row.points}</td></tr>)}</tbody></table></div><p className="demo-note">Scoring automation is the next step; until then, ungraded selections remain Pending.</p></>;
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
  const [cloudWeek, setCloudWeek] = useState(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  useEffect(() => { localStorage.setItem(LOCAL_PICKS_KEY, JSON.stringify({ picks, totalPoints })); }, [picks, totalPoints]);
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    const update = (nextSession) => {
      setSession(nextSession); setAuthReady(true);
      if (!nextSession) { setApproval(null); return; }
      // The database remains the authority for all protected operations. This
      // owner fast-path only prevents a slow status RPC from holding the PWA
      // on its startup screen.
      if (nextSession.user.email?.toLowerCase() === OWNER_EMAIL) setApproval({ status: "approved", is_owner: true });
      getApprovalStatus().then(setApproval).catch(() => setNotice("Could not confirm account access. Try reopening or checking your connection."));
    };
    const fallbackTimer = window.setTimeout(() => setAuthReady(true), 2_500);
    getSession().then(update).catch(() => setAuthReady(true));
    const unsubscribe = onAuthChange(update);
    return () => { window.clearTimeout(fallbackTimer); unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!isSupabaseConfigured || approval?.status !== "approved") return;
    loadPublishedWeek().then((week) => { if (week) { setCloudWeek(week); setGames(week.games); } }).catch((error) => setNotice(`Could not load the shared slate: ${error.message}`));
  }, [approval]);
  async function publishGames(nextSlate) {
    let gamesForPicks = nextSlate.games;
    if (isSupabaseConfigured) {
      try { const week = await publishWeek(nextSlate); setCloudWeek(week); gamesForPicks = week.games; setNotice("The slate is published for approved users."); }
      catch (error) { setNotice(`Could not publish the slate: ${error.message}`); return; }
    } else { localStorage.setItem(LOCAL_SLATE_KEY, JSON.stringify({ games: nextSlate.games, selectedIds: nextSlate.games.map((game) => game.id) })); setNotice("Your new slate is ready for local pick testing."); }
    setGames(gamesForPicks); setPicks({}); setPage("picks");
  }
  if (!authReady) return <main className="app-shell"><p className="demo-note">Checking your account…</p></main>;
  if (isSupabaseConfigured && !session) return <SignInScreen />;
  if (isSupabaseConfigured && approval?.status !== "approved") return <main className="app-shell auth-shell"><section className="auth-card"><p className="eyebrow">ACCESS PENDING</p><h1>Your account is waiting for approval.</h1><p>You’ll be able to make picks after the group administrator approves your request.</p></section></main>;
  return <main className="app-shell"><header className="topbar"><div className="brand"><span aria-hidden="true" className="helmet-morph"><img className="helmet-wolverine" src={WOLVERINE_HELMET} /><img className="helmet-lions" src={LIONS_HELMET} /></span><span>Saturday Slate</span></div><button className="profile-button" type="button" aria-label="Open account menu">IG <ChevronDown size={15} /></button></header><nav className="page-nav" aria-label="Main navigation"><button className={page === "picks" ? "active" : ""} onClick={() => setPage("picks")} type="button">Picks</button><button className={page === "scores" ? "active" : ""} onClick={() => setPage("scores")} type="button">Scores</button><button className={page === "results" ? "active" : ""} onClick={() => setPage("results")} type="button">Results</button>{(!isSupabaseConfigured || approval?.is_owner) && <button className={page === "admin" ? "active" : ""} onClick={() => setPage("admin")} type="button">Admin</button>}</nav>{page === "admin" ? <AdminPage onPublish={publishGames} ownerId={session?.user?.id} /> : page === "scores" ? <ScoresPage games={games} /> : page === "results" ? <ResultsPage cloudWeek={cloudWeek} games={games} viewerId={session?.user?.id} /> : <PicksPage games={games} picks={picks} setPicks={setPicks} totalPoints={totalPoints} setTotalPoints={setTotalPoints} notice={notice} setNotice={setNotice} cloudWeek={cloudWeek} />}<BuildStamp /></main>;
}
