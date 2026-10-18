"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { textOn } from "@/lib/client/identity";
import { hintFor, NEW_GAME, nextDrawer, normalizeGuess, pickWords, REVEAL_MS, ROUND_MS, wordHash, type GameState } from "@/lib/game";
import type { ElementRow } from "@/lib/types";
import { ChatThread } from "./ChatThread";
import { useBoard } from "./context";

function useTicker(ms: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

/** The secret word stays in this browser only (kept across a reload of the tab). */
function useSecret(gameId: string, round: number) {
  const key = `drawory:word:${gameId}:${round}`;
  const [word, setWordState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const [forKey, setForKey] = useState(key);
  if (forKey !== key) {
    setForKey(key);
    let next: string | null = null;
    try {
      next = sessionStorage.getItem(key);
    } catch {}
    setWordState(next);
  }
  const setWord = (w: string) => {
    try {
      sessionStorage.setItem(key, w);
    } catch {}
    setWordState(w);
  };
  return [word, setWord] as const;
}

/**
 * A Pictionary area: put it anywhere on the board and size it as you like. The person drawing
 * draws inside it; everyone else guesses in the box on the side.
 */
export function GameView({ row }: { row: ElementRow }) {
  const ctx = useBoard();
  const { me } = ctx;
  const g: GameState = row.data.game ?? NEW_GAME;
  const myTurn = g.drawer === me.id;
  const playing = g.players.some((p) => p.id === me.id);
  const drawer = g.players.find((p) => p.id === g.drawer);
  const [word, setWord] = useSecret(row.id, g.round);
  const [choices, setChoices] = useState<string[]>([]);
  const [guess, setGuess] = useState("");
  const [nope, setNope] = useState<string | null>(null);
  useTicker(1000);
  const now = ctx.serverNow();
  const left = g.endsAt ? Math.max(0, Math.ceil((g.endsAt - now) / 1000)) : 0;
  const drawerHere = !!g.drawer && (g.drawer === me.id || ctx.onlineIds.includes(g.drawer));
  const set = (s: Partial<GameState>, guard: { ifRound?: number; ifStatus?: GameState["status"] } = {}) => ctx.edit(row.id, { k: "game-set", set: s, ...guard });

  // My turn to choose: three words to pick from.
  const choosingKey = g.status === "choosing" && myTurn ? `${g.round}` : "";
  const lastChoosing = useRef("");
  useEffect(() => {
    if (!choosingKey || lastChoosing.current === choosingKey) return;
    lastChoosing.current = choosingKey;
    queueMicrotask(() => setChoices(pickWords(3)));
  }, [choosingKey]);

  // The game moves itself along: the drawer ends the round when time's up or everyone guessed;
  // anyone moves from the reveal to the next turn, and covers for a drawer who left.
  const advanced = useRef("");
  useEffect(() => {
    if (ctx.readOnly) return;
    const once = (key: string, fn: () => void) => {
      if (advanced.current === key) return;
      advanced.current = key;
      fn();
    };
    const guessers = g.players.filter((p) => p.id !== g.drawer).length;
    if (g.status === "drawing") {
      const everyone = guessers > 0 && (g.correct?.length ?? 0) >= guessers;
      const timeUp = !!g.endsAt && now >= g.endsAt;
      if (myTurn && (everyone || timeUp)) {
        once(`reveal-${g.round}`, () => set({ status: "reveal", lastWord: word ?? null, endsAt: now + REVEAL_MS }, { ifRound: g.round, ifStatus: "drawing" }));
      } else if (!drawerHere && timeUp && now >= (g.endsAt ?? 0) + 3000) {
        once(`reveal-${g.round}`, () => set({ status: "reveal", lastWord: null, endsAt: now + REVEAL_MS }, { ifRound: g.round, ifStatus: "drawing" }));
      }
    } else if (g.status === "reveal" && g.endsAt && now >= g.endsAt) {
      once(`next-${g.round}`, () => {
        const next = nextDrawer(g);
        if (!next) return set({ status: "lobby" }, { ifRound: g.round });
        set({ status: "choosing", round: g.round + 1, drawer: next.id, correct: [], hash: null, hint: null, endsAt: null, lastWord: null }, { ifRound: g.round, ifStatus: "reveal" });
      });
    }
  });

  async function choose(w: string) {
    const hash = await wordHash(g.round, w);
    setWord(w);
    setChoices([]);
    ctx.clearInside(row.id);
    set({ status: "drawing", hash, hint: hintFor(w), endsAt: ctx.serverNow() + ROUND_MS, correct: [] }, { ifRound: g.round, ifStatus: "choosing" });
  }

  async function submitGuess() {
    const text = guess.trim();
    if (!text) return;
    setGuess("");
    if (g.status === "drawing" && g.hash && !myTurn && (await wordHash(g.round, text)) === g.hash) {
      // A right answer is never posted, so nobody else sees the word.
      ctx.edit(row.id, { k: "game-correct", user: me.id, round: g.round });
      setNope(null);
      return;
    }
    if (myTurn && word && normalizeGuess(text).includes(normalizeGuess(word))) {
      setNope("Don't give the word away!");
      return;
    }
    void ctx.sendChat(row.id, text);
  }

  const start = () => {
    const first = g.players[0];
    if (!first) return;
    set(
      { status: "choosing", round: g.round + 1, drawer: first.id, correct: [], hash: null, hint: null, endsAt: null, lastWord: null, players: g.players.map((p) => ({ ...p, pts: 0 })) },
      { ifStatus: "lobby" },
    );
  };
  const ranked = [...g.players].sort((a, b) => b.pts - a.pts);

  return (
    <div className="game">
      <div className="game-panel" data-interactive>
        <div className="game-head">
          <Icon name="pen" size={18} />
          <strong>Pictionary</strong>
          {g.status === "drawing" && <span className={`game-timer${left <= 10 ? " low" : ""}`}>{left}s</span>}
        </div>

        <div className="game-status">
          {g.status === "lobby" && <span>Join, then start when everyone&apos;s in. Drawings go in this area.</span>}
          {g.status === "choosing" &&
            (myTurn ? (
              <div className="game-choices">
                <span>Your turn. Pick a word to draw:</span>
                {choices.map((w) => (
                  <button key={w} type="button" className="btn" data-interactive onClick={() => void choose(w)}>
                    {w}
                  </button>
                ))}
              </div>
            ) : (
              <span>
                <strong>{drawer?.name ?? "Someone"}</strong> is picking a word…
              </span>
            ))}
          {g.status === "drawing" &&
            (myTurn ? (
              <span>
                Draw <strong className="game-word">{word ?? "your word"}</strong> in the area. No letters!
              </span>
            ) : (
              <span>
                <strong>{drawer?.name ?? "Someone"}</strong> is drawing <span className="game-hint">{g.hint}</span>
              </span>
            ))}
          {g.status === "reveal" && (
            <span>
              {g.lastWord ? (
                <>
                  It was <strong className="game-word">{g.lastWord}</strong>
                </>
              ) : (
                "Time's up"
              )}
              {` · ${g.correct?.length ?? 0} got it`}
            </span>
          )}
        </div>

        <ol className="game-scores">
          {ranked.map((p) => (
            <li key={p.id} className={(g.correct ?? []).includes(p.id) ? "got-it" : undefined}>
              <span className="avatar" style={{ background: p.color, color: textOn(p.color), width: 22, height: 22, fontSize: 11 }}>
                {p.name.charAt(0).toUpperCase()}
              </span>
              <span className="game-name">
                {p.name}
                {p.id === g.drawer && g.status !== "lobby" ? " ✏️" : ""}
              </span>
              <span className="game-pts">{p.pts}</span>
            </li>
          ))}
          {!g.players.length && <li className="muted">No players yet</li>}
        </ol>

        {!ctx.readOnly && (
          <div className="game-actions">
            {!playing ? (
              <button type="button" className="btn btn-primary" data-interactive onClick={() => ctx.edit(row.id, { k: "game-join", user: me.id, name: me.name, color: me.color })}>
                Join
              </button>
            ) : g.status === "lobby" ? (
              <>
                <button type="button" className="btn btn-primary" data-interactive disabled={g.players.length < 2} onClick={start} title={g.players.length < 2 ? "Needs at least 2 players" : undefined}>
                  Start
                </button>
                <button type="button" className="btn btn-ghost" data-interactive onClick={() => ctx.edit(row.id, { k: "game-leave", user: me.id })}>
                  Leave
                </button>
              </>
            ) : (
              <>
                {(myTurn || !drawerHere) && g.status !== "reveal" && (
                  <button
                    type="button"
                    className="btn"
                    data-interactive
                    onClick={() => set({ status: "reveal", lastWord: myTurn ? word ?? null : null, endsAt: ctx.serverNow() + 2000 }, { ifRound: g.round })}
                  >
                    {myTurn ? "Skip my turn" : "Skip their turn"}
                  </button>
                )}
                <button type="button" className="btn btn-ghost" data-interactive onClick={() => set({ status: "lobby", drawer: null, hash: null, hint: null, endsAt: null })}>
                  End game
                </button>
              </>
            )}
          </div>
        )}

        <div className="game-chat chatbox">
          <ChatThread
            messages={ctx.chatFor(row.id)}
            me={me}
            readOnly
            onSend={(b) => ctx.sendChat(row.id, b)}
            onReact={ctx.react}
            roomEmojis={ctx.roomEmojis}
            inputId={`game-${row.id}`}
          />
        </div>
        {!ctx.readOnly && playing && g.status === "drawing" && !myTurn && !(g.correct ?? []).includes(me.id) && (
          <form
            className="game-guess"
            onSubmit={(e) => {
              e.preventDefault();
              void submitGuess();
            }}
          >
            <input
              className="input"
              aria-label="Your guess"
              placeholder="Your guess"
              value={guess}
              maxLength={60}
              data-interactive
              onChange={(e) => setGuess(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button type="submit" className="btn btn-primary" data-interactive disabled={!guess.trim()}>
              Guess
            </button>
          </form>
        )}
        {(g.correct ?? []).includes(me.id) && g.status === "drawing" && <p className="game-yay">You got it! Wait for the others.</p>}
        {myTurn && g.status === "drawing" && (
          <form
            className="game-guess"
            onSubmit={(e) => {
              e.preventDefault();
              void submitGuess();
            }}
          >
            <input
              className="input"
              aria-label="Say something"
              placeholder="Say something (not the word)"
              value={guess}
              maxLength={60}
              data-interactive
              onChange={(e) => {
                setGuess(e.target.value);
                setNope(null);
              }}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </form>
        )}
        {nope && <p className="field-error">{nope}</p>}
      </div>
    </div>
  );
}
