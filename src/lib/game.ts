// Pictionary, played inside a "game" area on the board. One person draws a secret word in the
// area; everyone else guesses. The word itself never leaves the drawer's browser: the board only
// stores a fingerprint (hash) of it, and each guesser's browser checks guesses against that.

export interface GamePlayer {
  id: string;
  name: string;
  color: string;
  pts: number;
}

export interface GameState {
  status: "lobby" | "choosing" | "drawing" | "reveal";
  round: number;
  players: GamePlayer[];
  drawer?: string | null;
  /** Fingerprint of the secret word, and a hint like "_ _ _ _  _ _ _". */
  hash?: string | null;
  hint?: string | null;
  /** When drawing or the reveal ends (server time, ms). */
  endsAt?: number | null;
  /** Who guessed it this round. */
  correct?: string[];
  lastWord?: string | null;
}

export const ROUND_MS = 80_000;
export const REVEAL_MS = 6_000;

export const NEW_GAME: GameState = { status: "lobby", round: 0, players: [], correct: [] };

export const normalizeGuess = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export async function wordHash(round: number, word: string) {
  const bytes = new TextEncoder().encode(`${round}:${normalizeGuess(word)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const hintFor = (word: string) => word.replace(/[^\s]/g, "_");

/** Points for the n-th person to guess right (0-based), and for the drawer per right guess. */
export const guessPoints = (n: number) => Math.max(1, 3 - n);

export const WORDS = [
  "apple", "banana", "pizza", "rocket", "guitar", "castle", "dragon", "rainbow", "volcano", "penguin",
  "giraffe", "octopus", "snowman", "umbrella", "bicycle", "airplane", "lighthouse", "sandwich", "popcorn", "cactus",
  "pirate", "robot", "mermaid", "unicorn", "dinosaur", "butterfly", "spider", "turtle", "elephant", "kangaroo",
  "hamburger", "ice cream", "birthday cake", "cupcake", "donut", "coffee", "teapot", "fork", "candle", "lamp",
  "telescope", "camera", "headphones", "keyboard", "television", "clock", "key", "lock", "ladder", "bridge",
  "tent", "campfire", "mountain", "island", "waterfall", "beach", "desert", "forest", "moon", "sun",
  "star", "comet", "planet", "alien", "ghost", "zombie", "vampire", "witch", "wizard", "crown",
  "diamond", "treasure", "map", "compass", "anchor", "ship", "submarine", "train", "bus", "tractor",
  "helicopter", "skateboard", "surfboard", "basketball", "football", "tennis", "bowling", "trophy", "medal", "kite",
  "balloon", "present", "fireworks", "snowflake", "lightning", "tornado", "cloud", "umbrella", "rain boots", "scarf",
  "glasses", "hat", "sock", "shoe", "backpack", "toothbrush", "bathtub", "bed", "pillow", "chair",
  "cat", "dog", "fish", "bird", "rabbit", "mouse", "snake", "frog", "bee", "owl",
  "shark", "whale", "crab", "snail", "horse", "cow", "pig", "sheep", "chicken", "duck",
  "flower", "tree", "mushroom", "leaf", "pumpkin", "carrot", "strawberry", "watermelon", "cherry", "lemon",
  "house", "school", "hospital", "castle", "pyramid", "eiffel tower", "igloo", "windmill", "ferris wheel", "roller coaster",
  "sleeping", "dancing", "swimming", "running", "singing", "cooking", "fishing", "painting", "reading", "laughing",
  "superhero", "ninja", "astronaut", "chef", "doctor", "firefighter", "king", "queen", "princess", "clown",
];

export function pickWords(n: number, avoid: string[] = []) {
  const pool = [...new Set(WORDS)].filter((w) => !avoid.includes(w));
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

/** Who draws after the current drawer (players take turns in the order they joined). */
export function nextDrawer(g: GameState) {
  if (!g.players.length) return null;
  const i = g.players.findIndex((p) => p.id === g.drawer);
  return g.players[(i + 1) % g.players.length];
}
