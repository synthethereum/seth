import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import Database from "better-sqlite3";
import cron from "node-cron";
import http from "http";
import { WebSocketServer } from "ws";

// ======================================================
// INIT EXPRESS
// ======================================================
const app = express();
app.use(express.json());
app.use(cors());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// ======================================================
// INIT SQLITE (BETTER-SQLITE3)
// ======================================================
const db = new Database("./database.sqlite");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT UNIQUE,
  username TEXT,
  score INTEGER DEFAULT 0,
  duel_score INTEGER DEFAULT 0,
  balance INTEGER DEFAULT 1000,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT,
  market_id TEXT,
  question TEXT,
  side TEXT,
  amount INTEGER,
  coeff REAL,
  potential_win REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active'
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT,
  yes_price REAL,
  no_price REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

console.log("SQLite ready (better-sqlite3).");

// ======================================================
// CRON → update Polymarket prices every minute
// ======================================================
async function updatePrices() {
  try {
    const r = await fetch("https://gamma-api.polymarket.com/markets?limit=200&active=true");
    const data = await r.json();

    for (const m of data) {
      if (!m.outcomes?.includes("Yes") || !m.outcomes?.includes("No")) continue;

      const outcomes = Array.isArray(m.outcomes) ? m.outcomes : JSON.parse(m.outcomes);
      const prices = Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices);

      const yesIdx = outcomes.indexOf("Yes");
      const noIdx = outcomes.indexOf("No");

      db.prepare(`
        INSERT INTO price_history (market_id, yes_price, no_price)
        VALUES (?, ?, ?)
      `).run(m.id, Number(prices[yesIdx] || 0), Number(prices[noIdx] || 0));
    }

    console.log("Price history updated:", new Date().toISOString());
  } catch (err) {
    console.error("Price update failed:", err);
  }
}

cron.schedule("*/1 * * * *", updatePrices);
updatePrices();

// ======================================================
// LOGIN
// ======================================================
app.post("/api/login", (req, res) => {
  const { wallet, username } = req.body;

  if (!wallet || !username)
    return res.status(400).json({ error: "Wallet + username required" });

  const existing = db.prepare("SELECT * FROM users WHERE wallet = ?").get(wallet);

  if (existing) {
    return res.json({ user: existing, created: false });
  }

  db.prepare(`
    INSERT INTO users (wallet, username, balance)
    VALUES (?, ?, ?)
  `).run(wallet, username, 1000);

  const user = db.prepare("SELECT * FROM users WHERE wallet = ?").get(wallet);

  res.json({ user, created: true });
});

// ======================================================
// RANDOM YES/NO QUESTION (Polymarket)
// ======================================================
const GAMMA_URL = "https://gamma-api.polymarket.com/markets?limit=1000&active=true";
const ALLOWED_CATEGORIES = ["crypto", "politics", "US-current-affairs"];

async function getRandomMarket() {
  const r = await fetch(GAMMA_URL);
  const data = await r.json();

  const markets = data
    .filter(m => m.outcomes?.includes("Yes") && m.outcomes.includes("No"))
    .filter(m => ALLOWED_CATEGORIES.includes(m.category))
    .map(m => {
      const outcomes = Array.isArray(m.outcomes) ? m.outcomes : JSON.parse(m.outcomes);
      const prices = Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices);

      const yesIdx = outcomes.indexOf("Yes");
      const noIdx = outcomes.indexOf("No");

      return {
        id: m.id,
        question: m.question,
        yesProb: Number(prices[yesIdx]),
        noProb: Number(prices[noIdx])
      };
    });

  return markets[Math.floor(Math.random() * markets.length)];
}

app.get("/api/polymarket-question", async (_, res) => {
  try {
    const q = await getRandomMarket();
    res.json(q);
  } catch {
    res.status(500).json({ error: "Failed to fetch question" });
  }
});

// ======================================================
// WEBSOCKET DUEL MODE
// ======================================================
const PORT = 4000;
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/duel" });

const waitingPlayers = [];
const duels = new Map();
let duelCounter = 1;

const ROUNDS = 5;
const ROUND_MS = 15000;

function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function createDuel(p1, p2) {
  const duelId = "duel-" + duelCounter++;

  const duel = {
    id: duelId,
    sockets: [p1.ws, p2.ws],
    wallets: [p1.wallet, p2.wallet],
    usernames: [p1.username, p2.username],
    scores: [0, 0],
    answered: [null, null],
    round: 0,
  };

  duels.set(duelId, duel);

  p1.ws.duelId = duelId;
  p1.ws.playerIndex = 0;

  p2.ws.duelId = duelId;
  p2.ws.playerIndex = 1;

  duel.sockets.forEach((ws, idx) =>
    safeSend(ws, {
      type: "match_found",
      opponent: {
        wallet: duel.wallets[1 - idx],
        username: duel.usernames[1 - idx]
      },
      totalRounds: ROUNDS
    })
  );

  startRound(duel);
}

async function startRound(duel) {
  if (duel.round >= ROUNDS) return finishDuel(duel);

  duel.round++;
  duel.answered = [null, null];

  const q = await getRandomMarket();
  duel.correct = q.yesProb >= q.noProb ? "yes" : "no";

  duel.sockets.forEach(ws =>
    safeSend(ws, {
      type: "round_start",
      round: duel.round,
      totalRounds: ROUNDS,
      question: { text: q.question },
      roundTime: ROUND_MS / 1000
    })
  );

  duel.timer && clearTimeout(duel.timer);
  duel.timer = setTimeout(() => endRound(duel), ROUND_MS);
}

function endRound(duel) {
  const correct = duel.correct;

  const deltas = [0, 0];
  for (let i = 0; i < 2; i++) {
    if (duel.answered[i] === correct) {
      duel.scores[i] += 10;
      deltas[i] = 10;
    }
    db.prepare("UPDATE users SET duel_score = duel_score + ? WHERE wallet = ?")
      .run(deltas[i], duel.wallets[i]);
  }

  duel.sockets.forEach((ws, idx) =>
    safeSend(ws, {
      type: "round_result",
      correctAnswer: correct,
      yourAnswer: duel.answered[idx],
      roundDelta: deltas[idx],
      totalScore: duel.scores[idx],
      opponentTotalScore: duel.scores[1 - idx]
    })
  );

  setTimeout(() => startRound(duel), 2000);
}

function finishDuel(duel) {
  let winner = "draw";
  if (duel.scores[0] > duel.scores[1]) winner = duel.wallets[0];
  else if (duel.scores[1] > duel.scores[0]) winner = duel.wallets[1];

  duel.sockets.forEach((ws, idx) =>
    safeSend(ws, {
      type: "duel_finished",
      yourScore: duel.scores[idx],
      opponentScore: duel.scores[1 - idx],
      winner
    })
  );

  duels.delete(duel.id);
}

wss.on("connection", ws => {
  ws.on("message", data => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch { return; }

    if (msg.type === "init") {
      waitingPlayers.push({ ws, wallet: msg.wallet, username: msg.username });
      safeSend(ws, { type: "waiting" });

      if (waitingPlayers.length >= 2) {
        createDuel(waitingPlayers.shift(), waitingPlayers.shift());
      }
      return;
    }

    if (msg.type === "answer") {
      const duel = duels.get(ws.duelId);
      if (!duel) return;

      duel.answered[ws.playerIndex] = msg.choice;

      if (duel.answered[0] !== null && duel.answered[1] !== null) {
        clearTimeout(duel.timer);
        endRound(duel);
      }
    }
  });

  ws.on("close", () => {});
});

// ======================================================
// START SERVER
// ======================================================
server.listen(PORT, () =>
  console.log(`Backend running on http://localhost:${PORT}`)
);
