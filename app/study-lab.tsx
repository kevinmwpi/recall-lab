"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Clock3,
  Coffee,
  Import,
  Layers3,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

type Familiarity = "unseen" | "unfamiliar" | "inconsistent" | "strong";

type StudyCard = {
  id: string;
  front: string;
  back: string;
  score: number | null;
  attempts: number;
  lastReviewed?: number;
};

type StudySet = {
  id: string;
  name: string;
  cards: StudyCard[];
  createdAt: number;
};

type Session = {
  setId: string;
  mode: "free" | "pomodoro";
  focusSeconds: number;
  breakSeconds: number;
  phase: "focus" | "break";
  secondsLeft: number;
  running: boolean;
  cardIds: string[];
  index: number;
  totalReviews: number;
  blockReviews: number;
  cycle: number;
};

type RecallRating = "missed" | "shaky" | "known";

const STORAGE_KEY = "recall-lab-study-sets-v2";
const STRONG_THRESHOLD = 75;
const INCONSISTENT_THRESHOLD = 40;

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function categoryFor(score: number | null): Familiarity {
  if (score === null) return "unseen";
  if (score >= STRONG_THRESHOLD) return "strong";
  if (score >= INCONSISTENT_THRESHOLD) return "inconsistent";
  return "unfamiliar";
}

function statsFor(set: StudySet | undefined) {
  const base = { strong: 0, inconsistent: 0, unfamiliar: 0, unseen: 0 };
  if (!set) return base;
  return set.cards.reduce((stats, card) => {
    stats[categoryFor(card.score)] += 1;
    return stats;
  }, base);
}

function decodeSeparator(value: string) {
  return value.replaceAll("\\t", "\t").replaceAll("\\n", "\n");
}

function parseCards(
  raw: string,
  termMode: string,
  cardMode: string,
  customTerm: string,
  customCard: string,
) {
  const termSeparator =
    termMode === "tab" ? "\t" : termMode === "comma" ? "," : decodeSeparator(customTerm);
  const cardSeparator =
    cardMode === "newline" ? "\n" : cardMode === "semicolon" ? ";" : decodeSeparator(customCard);

  if (!termSeparator || !cardSeparator) return { cards: [] as Array<{ front: string; back: string }>, invalid: 0 };

  const rows = cardSeparator === "\n" ? raw.split(/\r?\n/) : raw.split(cardSeparator);
  let invalid = 0;
  const cards = rows.flatMap((row) => {
    const clean = row.trim();
    if (!clean) return [];
    const splitAt = clean.indexOf(termSeparator);
    if (splitAt < 0) {
      invalid += 1;
      return [];
    }
    const front = clean.slice(0, splitAt).trim();
    const back = clean.slice(splitAt + termSeparator.length).trim();
    if (!front || !back) {
      invalid += 1;
      return [];
    }
    return [{ front, back }];
  });

  return { cards, invalid };
}

function FamiliarityPill({ score }: { score: number | null }) {
  const category = categoryFor(score);
  const label = category === "unseen" ? "Unseen" : category[0].toUpperCase() + category.slice(1);
  return (
    <span className={`familiarity-pill ${category}`}>
      <span /> {label}{score === null ? "" : ` Â· ${score}`}
    </span>
  );
}

function TimerRing({ session, compact = false }: { session: Session; compact?: boolean }) {
  const total = session.phase === "focus" ? session.focusSeconds : session.breakSeconds;
  const remaining = total ? session.secondsLeft / total : 0;
  return (
    <div
      className={`quiet-timer ${compact ? "compact" : ""} ${session.phase}`}
      style={{ "--remaining": `${Math.max(0, remaining) * 360}deg` } as React.CSSProperties}
      role="progressbar"
      aria-label={`${Math.round(remaining * 100)} percent of ${session.phase} interval remaining`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(remaining * 100)}
    >
      <span>{session.phase === "focus" ? <Target size={compact ? 13 : 20} /> : <Coffee size={compact ? 13 : 20} />}</span>
    </div>
  );
}

export function StudyLab() {
  const [sets, setSets] = useState<StudySet[]>([]);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [view, setView] = useState<"library" | "import" | "session" | "summary">("library");
  const [ready, setReady] = useState(false);

  const [setName, setSetName] = useState("");
  const [rawCards, setRawCards] = useState("");
  const [termMode, setTermMode] = useState("tab");
  const [cardMode, setCardMode] = useState("newline");
  const [customTerm, setCustomTerm] = useState("");
  const [customCard, setCustomCard] = useState("");

  const [studyMode, setStudyMode] = useState("free");
  const [session, setSession] = useState<Session | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [shownAt, setShownAt] = useState(Date.now());
  const [recallMs, setRecallMs] = useState<number | null>(null);
  const [sessionStartStats, setSessionStartStats] = useState<ReturnType<typeof statsFor> | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as StudySet[];
        if (Array.isArray(parsed)) {
          setSets(parsed);
          setActiveSetId(parsed[0]?.id ?? null);
          setView(parsed.length ? "library" : "import");
        }
      } else {
        setView("import");
      }
    } catch {
      setView("import");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (ready) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
  }, [sets, ready]);

  useEffect(() => {
    if (!session || session.mode !== "pomodoro" || !session.running) return;
    const interval = window.setInterval(() => {
      setSession((current) => {
        if (!current || !current.running) return current;
        if (current.secondsLeft > 1) return { ...current, secondsLeft: current.secondsLeft - 1 };
        if (current.phase === "focus") {
          return {
            ...current,
            phase: "break",
            secondsLeft: current.breakSeconds,
            running: true,
          };
        }
        setRevealed(false);
        setRecallMs(null);
        setShownAt(Date.now());
        return {
          ...current,
          phase: "focus",
          secondsLeft: current.focusSeconds,
          running: true,
          blockReviews: 0,
          cycle: current.cycle + 1,
        };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [session?.mode, session?.running, session?.phase]);

  const activeSet = sets.find((set) => set.id === activeSetId);
  const activeStats = useMemo(() => statsFor(activeSet), [activeSet]);
  const parsedImport = useMemo(
    () => parseCards(rawCards, termMode, cardMode, customTerm, customCard),
    [rawCards, termMode, cardMode, customTerm, customCard],
  );

  const sessionSet = sets.find((set) => set.id === session?.setId);
  const currentCardId = session?.cardIds[session.index % Math.max(1, session.cardIds.length)];
  const currentCard = sessionSet?.cards.find((card) => card.id === currentCardId);

  function openSet(id: string) {
    setActiveSetId(id);
    setView("library");
  }

  function importSet() {
    if (!setName.trim() || !parsedImport.cards.length) return;
    const newSet: StudySet = {
      id: makeId(),
      name: setName.trim(),
      createdAt: Date.now(),
      cards: parsedImport.cards.map((card) => ({
        id: makeId(),
        front: card.front,
        back: card.back,
        score: null,
        attempts: 0,
      })),
    };
    setSets((current) => [...current, newSet]);
    setActiveSetId(newSet.id);
    setSetName("");
    setRawCards("");
    setTermMode("tab");
    setCardMode("newline");
    setCustomTerm("");
    setCustomCard("");
    setView("library");
  }

  function startStudy() {
    if (!activeSet?.cards.length) return;
    const preset = studyMode === "15-3" ? [15, 3] : studyMode === "25-5" ? [25, 5] : [45, 10];
    const mode = studyMode === "free" ? "free" : "pomodoro";
    const newSession: Session = {
      setId: activeSet.id,
      mode,
      focusSeconds: mode === "free" ? 0 : preset[0] * 60,
      breakSeconds: mode === "free" ? 0 : preset[1] * 60,
      phase: "focus",
      secondsLeft: mode === "free" ? 0 : preset[0] * 60,
      running: mode === "pomodoro",
      cardIds: activeSet.cards.map((card) => card.id),
      index: 0,
      totalReviews: 0,
      blockReviews: 0,
      cycle: 1,
    };
    setSessionStartStats(statsFor(activeSet));
    setSession(newSession);
    setRevealed(false);
    setRecallMs(null);
    setShownAt(Date.now());
    setView("session");
  }

  function revealAnswer() {
    if (!revealed) {
      setRecallMs(Date.now() - shownAt);
      setRevealed(true);
    }
  }

  function rateRecall(rating: RecallRating) {
    if (!session || !currentCard || recallMs === null) return;
    let result = 0;
    if (rating === "missed") result = 0;
    else if (recallMs > 15_000) result = 25;
    else if (rating === "shaky") result = 55;
    else if (recallMs <= 6_000) result = 100;
    else result = 68;

    setSets((currentSets) =>
      currentSets.map((set) =>
        set.id !== session.setId
          ? set
          : {
              ...set,
              cards: set.cards.map((card) =>
                card.id !== currentCard.id
                  ? card
                  : {
                      ...card,
                      score: card.score === null ? result : Math.round(card.score * 0.6 + result * 0.4),
                      attempts: card.attempts + 1,
                      lastReviewed: Date.now(),
                    },
              ),
            },
      ),
    );
    setSession((current) =>
      current
        ? {
            ...current,
            index: current.index + 1,
            totalReviews: current.totalReviews + 1,
            blockReviews: current.blockReviews + 1,
          }
        : current,
    );
    setRevealed(false);
    setRecallMs(null);
    setShownAt(Date.now());
  }

  function toggleTimer() {
    setSession((current) => (current ? { ...current, running: !current.running } : current));
    if (session && !session.running) {
      setRevealed(false);
      setRecallMs(null);
      setShownAt(Date.now());
    }
  }

  function skipBreak() {
    setSession((current) =>
      current
        ? {
            ...current,
            phase: "focus",
            secondsLeft: current.focusSeconds,
            blockReviews: 0,
            cycle: current.cycle + 1,
            running: true,
          }
        : current,
    );
    setShownAt(Date.now());
  }

  function finishSession() {
    setView("summary");
  }

  function returnToSet() {
    if (session?.setId) setActiveSetId(session.setId);
    setSession(null);
    setSessionStartStats(null);
    setView("library");
  }

  if (!ready) {
    return <main className="loading-screen"><Brain size={24} /><span>Loading study setsâ¦</span></main>;
  }

  if (view === "session" && session && sessionSet) {
    return (
      <main className="study-session">
        <header className="session-header">
          <div className="session-identity">
            <span className="brand-mark"><Brain size={16} /></span>
            <div><span>{sessionSet.name}</span><small>{session.mode === "free" ? "Free study" : `Focus block ${session.cycle}`}</small></div>
          </div>
          <div className="session-status">
            <span>{session.totalReviews} reviewed</span>
            {session.mode === "pomodoro" && <TimerRing session={session} compact />}
            {session.mode === "pomodoro" && (
              <Button variant="ghost" size="icon" onClick={toggleTimer} aria-label={session.running ? "Pause focus timer" : "Resume focus timer"}>
                {session.running ? <Pause size={17} /> : <Play size={17} />}
              </Button>
            )}
            <Button variant="ghost" onClick={finishSession}>End session</Button>
          </div>
        </header>

        {session.phase === "break" ? (
          <section className="break-screen">
            <TimerRing session={session} />
            <span className="session-kicker">Intentional break</span>
            <h1>Step away from the cards.</h1>
            <p>You reviewed <strong>{session.blockReviews} cards</strong> this focus block. Stand up, get water, or look into the distance. Let your attention reset.</p>
            <div className="break-actions">
              <Button onClick={skipBreak}><CirclePlay size={17} /> Continue early</Button>
              <Button variant="outline" onClick={finishSession}>Finish session</Button>
            </div>
          </section>
        ) : !session.running && session.mode === "pomodoro" ? (
          <section className="paused-screen">
            <CirclePause size={42} />
            <span className="session-kicker">Focus paused</span>
            <h1>Return when you can give the card your full attention.</h1>
            <Button onClick={toggleTimer}><Play size={17} /> Resume focus</Button>
          </section>
        ) : currentCard ? (
          <section className="card-stage">
            <div className="card-stage-meta">
              <span>Card {(session.index % session.cardIds.length) + 1} of {session.cardIds.length}</span>
              <FamiliarityPill score={currentCard.score} />
            </div>
            <button className={`study-card ${revealed ? "revealed" : ""}`} onClick={revealAnswer} disabled={revealed}>
              <span className="card-face-label">{revealed ? "Answer" : "Prompt"}</span>
              <h1>{revealed ? currentCard.back : currentCard.front}</h1>
              {!revealed && <span className="reveal-instruction">Recall it first, then reveal <ChevronRight size={16} /></span>}
            </button>
            {revealed ? (
              <div className="recall-controls">
                <div>
                  <span>How well did you know it?</span>
                  <small>Slow recall is scored lower automatically.</small>
                </div>
                <div className="recall-buttons">
                  <Button variant="outline" onClick={() => rateRecall("missed")}><X size={15} /> Didnât know</Button>
                  <Button variant="outline" onClick={() => rateRecall("shaky")}><RotateCcw size={15} /> Not consistent</Button>
                  <Button onClick={() => rateRecall("known")}><Check size={15} /> Knew it</Button>
                </div>
              </div>
            ) : (
              <p className="speed-note">Familiarity uses both your rating and retrieval speed. Confident recall under 6 seconds earns the strongest signal; over 15 seconds is treated as unfamiliar.</p>
            )}
          </section>
        ) : null}
      </main>
    );
  }

  if (view === "summary" && session && sessionSet) {
    const finalStats = statsFor(sessionSet);
    const start = sessionStartStats ?? { strong: 0, inconsistent: 0, unfamiliar: 0, unseen: 0 };
    return (
      <main className="summary-screen">
        <div className="summary-card">
          <span className="summary-icon"><BarChart3 size={24} /></span>
          <span className="session-kicker">Session complete</span>
          <h1>{session.totalReviews} cards reviewed.</h1>
          <p>{sessionSet.name} now has a clearer knowledge map. Scores blend this session with prior attempts, so one lucky answer does not erase inconsistency.</p>
          <div className="summary-metrics">
            <div><strong>{finalStats.strong}</strong><span>Strong</span><small>{finalStats.strong - start.strong >= 0 ? "+" : ""}{finalStats.strong - start.strong} this session</small></div>
            <div><strong>{finalStats.inconsistent}</strong><span>Inconsistent</span><small>{finalStats.inconsistent - start.inconsistent >= 0 ? "+" : ""}{finalStats.inconsistent - start.inconsistent} this session</small></div>
            <div><strong>{finalStats.unfamiliar}</strong><span>Unfamiliar</span><small>{finalStats.unfamiliar - start.unfamiliar >= 0 ? "+" : ""}{finalStats.unfamiliar - start.unfamiliar} this session</small></div>
          </div>
          <div className="summary-actions">
            <Button onClick={() => { returnToSet(); setTimeout(startStudy, 0); }}><Play size={16} /> Study again</Button>
            <Button variant="outline" onClick={returnToSet}>Back to set</Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="workspace-shell">
      <aside className="set-sidebar">
        <div className="workspace-brand"><span className="brand-mark"><Brain size={16} /></span><div><strong>Recall Lab</strong><small>Study workspace</small></div></div>
        <Button className="import-set-button" onClick={() => setView("import")}><Plus size={16} /> Import study set</Button>
        <div className="sidebar-label"><span>Your sets</span><span>{sets.length}</span></div>
        <nav className="set-list" aria-label="Study sets">
          {sets.length ? sets.map((set) => {
            const stats = statsFor(set);
            return (
              <button key={set.id} className={set.id === activeSetId && view === "library" ? "active" : ""} onClick={() => openSet(set.id)}>
                <span className="set-icon"><Layers3 size={15} /></span>
                <span className="set-copy"><strong>{set.name}</strong><small>{set.cards.length} cards Â· {stats.strong} strong</small></span>
                <ChevronRight size={14} />
              </button>
            );
          }) : <p className="empty-set-list">No sets yet. Import your first deck to begin.</p>}
        </nav>
        <div className="sidebar-storage"><span><Check size={13} /></span><p><strong>Saved on this device</strong><br />Your sets and progress stay in this browser.</p></div>
      </aside>

      <section className="workspace-main">
        <header className="workspace-header">
          <div>
            <span className="mobile-brand"><Brain size={16} /> Recall Lab</span>
            <p>{view === "import" ? "Import" : "Study set"}</p>
            <h1>{view === "import" ? "Create a study set" : activeSet?.name ?? "Choose a set"}</h1>
          </div>
          {view === "import" && sets.length > 0 && <Button variant="ghost" onClick={() => setView("library")}><ArrowLeft size={16} /> Cancel</Button>}
        </header>

        {view === "import" ? (
          <div className="import-workspace">
            <section className="import-panel">
              <div className="field-group">
                <label htmlFor="set-name">Study set name</label>
                <Input id="set-name" value={setName} onChange={(event) => setSetName(event.target.value)} placeholder="e.g. Java OOP relationships" />
              </div>
              <div className="field-group">
                <div className="field-heading"><label htmlFor="card-data">Paste your cards</label><span>Word, Excel, Google Docs, or plain text</span></div>
                <Textarea
                  id="card-data"
                  value={rawCards}
                  onChange={(event) => setRawCards(event.target.value)}
                  placeholder={"interface\tcontract implemented by a class\nabstract class\tshared base behavior and state\ncomposition\thas-a relationship"}
                  className="card-data-input"
                />
              </div>

              <div className="separator-grid">
                <fieldset>
                  <legend>Between term and definition</legend>
                  <RadioGroup value={termMode} onValueChange={setTermMode} className="separator-options">
                    <label htmlFor="term-tab"><RadioGroupItem value="tab" id="term-tab" /> Tab</label>
                    <label htmlFor="term-comma"><RadioGroupItem value="comma" id="term-comma" /> Comma</label>
                    <label htmlFor="term-custom"><RadioGroupItem value="custom" id="term-custom" /> Custom</label>
                  </RadioGroup>
                  <Input aria-label="Custom term separator" value={customTerm} onChange={(event) => setCustomTerm(event.target.value)} placeholder="e.g. :: or \\t" disabled={termMode !== "custom"} />
                </fieldset>
                <fieldset>
                  <legend>Between cards</legend>
                  <RadioGroup value={cardMode} onValueChange={setCardMode} className="separator-options">
                    <label htmlFor="card-newline"><RadioGroupItem value="newline" id="card-newline" /> New line</label>
                    <label htmlFor="card-semicolon"><RadioGroupItem value="semicolon" id="card-semicolon" /> Semicolon</label>
                    <label htmlFor="card-custom"><RadioGroupItem value="custom" id="card-custom" /> Custom</label>
                  </RadioGroup>
                  <Input aria-label="Custom card separator" value={customCard} onChange={(event) => setCustomCard(event.target.value)} placeholder="e.g. || or \\n" disabled={cardMode !== "custom"} />
                </fieldset>
              </div>
              <div className="import-actions">
                <div><strong>{parsedImport.cards.length} valid cards</strong>{parsedImport.invalid > 0 && <span> Â· {parsedImport.invalid} skipped row{parsedImport.invalid === 1 ? "" : "s"}</span>}</div>
                <Button onClick={importSet} disabled={!setName.trim() || !parsedImport.cards.length}><Import size={16} /> Import set</Button>
              </div>
            </section>

            <aside className="import-preview">
              <div className="preview-heading"><span>Import preview</span><span>{parsedImport.cards.length} cards</span></div>
              {parsedImport.cards.length ? parsedImport.cards.slice(0, 4).map((card, index) => (
                <article key={`${card.front}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{card.front}</strong><p>{card.back}</p></div></article>
              )) : (
                <div className="preview-empty"><Import size={25} /><strong>Your cards will appear here</strong><p>Paste one card per line. By default, place a tab between each term and definition.</p></div>
              )}
              {parsedImport.cards.length > 4 && <p className="preview-more">+ {parsedImport.cards.length - 4} more cards</p>}
            </aside>
          </div>
        ) : activeSet ? (
          <div className="set-dashboard">
            <section className="knowledge-overview">
              <div className="overview-heading"><div><span className="eyebrow"><Sparkles size={13} /> Knowledge map</span><h2>{activeSet.cards.length} cards</h2></div><p>Familiarity changes with every attempt. Quick, correct recall raises a score; slow or missed recall lowers it.</p></div>
              <div className="mastery-bar" aria-label="Knowledge familiarity distribution">
                {activeSet.cards.length > 0 && <>
                  <span className="strong" style={{ width: `${(activeStats.strong / activeSet.cards.length) * 100}%` }} />
                  <span className="inconsistent" style={{ width: `${(activeStats.inconsistent / activeSet.cards.length) * 100}%` }} />
                  <span className="unfamiliar" style={{ width: `${(activeStats.unfamiliar / activeSet.cards.length) * 100}%` }} />
                  <span className="unseen" style={{ width: `${(activeStats.unseen / activeSet.cards.length) * 100}%` }} />
                </>}
              </div>
              <div className="stat-grid">
                <div><span className="status-dot strong" /><strong>{activeStats.strong}</strong><p>Strong</p></div>
                <div><span className="status-dot inconsistent" /><strong>{activeStats.inconsistent}</strong><p>Inconsistent</p></div>
                <div><span className="status-dot unfamiliar" /><strong>{activeStats.unfamiliar}</strong><p>Unfamiliar</p></div>
                <div><span className="status-dot unseen" /><strong>{activeStats.unseen}</strong><p>Unseen</p></div>
              </div>
            </section>

            <section className="session-setup">
              <div className="setup-heading"><span className="eyebrow"><Play size={13} /> Start studying</span><h2>Choose a session</h2></div>
              <RadioGroup value={studyMode} onValueChange={setStudyMode} className="mode-list">
                <label className={studyMode === "free" ? "selected" : ""} htmlFor="mode-free">
                  <RadioGroupItem value="free" id="mode-free" />
                  <span className="mode-icon"><BookOpen size={19} /></span>
                  <span><strong>Free study</strong><small>No timer or interruptions. Stop when you choose.</small></span>
                </label>
                <label className={studyMode === "15-3" ? "selected" : ""} htmlFor="mode-15"><RadioGroupItem value="15-3" id="mode-15" /><span className="mode-icon"><Clock3 size={19} /></span><span><strong>15 min focus Â· 3 min break</strong><small>A light sprint for quick review.</small></span></label>
                <label className={studyMode === "25-5" ? "selected" : ""} htmlFor="mode-25"><RadioGroupItem value="25-5" id="mode-25" /><span className="mode-icon"><Clock3 size={19} /></span><span><strong>25 min focus Â· 5 min break</strong><small>The classic Pomodoro split.</small></span></label>
                <label className={studyMode === "45-10" ? "selected" : ""} htmlFor="mode-45"><RadioGroupItem value="45-10" id="mode-45" /><span className="mode-icon"><Target size={19} /></span><span><strong>45 min focus Â· 10 min break</strong><small>For deeper, sustained practice.</small></span></label>
              </RadioGroup>
              <Button className="start-session-button" onClick={startStudy}><Play size={16} /> Begin session</Button>
            </section>

            <section className="card-progress-list">
              <div className="progress-list-heading"><div><span className="eyebrow"><BarChart3 size={13} /> Card progress</span><h2>Strength by note</h2></div><span>Rolling score Â· 0â100</span></div>
              <div className="progress-table">
                <div className="progress-table-header"><span>Card</span><span>Familiarity</span><span>Attempts</span></div>
                {activeSet.cards.map((card) => (
                  <div className="progress-row" key={card.id}>
                    <div><strong>{card.front}</strong><p>{card.back}</p></div>
                    <FamiliarityPill score={card.score} />
                    <span className="attempt-count">{card.attempts}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="no-active-set"><Layers3 size={30} /><h2>No study set selected</h2><p>Choose a set from the sidebar or import a new one.</p><Button onClick={() => setView("import")}><Plus size={16} /> Import study set</Button></div>
        )}
      </section>
    </main>
  );
}
