import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import cron from "node-cron";
import fetch from "node-fetch";
import http from "http";
import { WebSocketServer } from "ws";

// ----------------------------
// INIT APP
// ----------------------------
const app = express();
app.use(express.json());
app.use(cors());

// ----------------------------
// DATABASE INIT
// ----------------------------
const db = new Database("./database.sqlite");
console.log("SQLite loaded (better-sqlite3)");

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT UNIQUE,
  username TEXT,
  score INTEGER DEFAULT 0,
  duel_score INTEGER DEFAULT 0,
  balance INTEGER DEFAULT 1000,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`).run();

db.prepare(`
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
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT,
  yes_price REAL,
  no_price REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`).run();

// ----------------------------
// CRON – POLYMARKET PRICE LOGGING
// ----------------------------
async function updatePrices() {
  try {
    const r = await fetch("https://gamma-api.polymarket.com/markets?limit=200&active=true");
    const data = await r.json();

    const insert = db.prepare(`
      INSERT INTO price_history (market_id, yes_price, no_price)
      VALUES (?, ?, ?)
    `);

    for (const m of data) {
      if (!m.outcomes?.includes("Yes") || !m.outcomes.includes("No")) continue;

      let outcomes = Array.isArray(m.outcomes) ? m.outcomes : JSON.parse(m.outcomes);
      let prices = Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices);

      const yesIdx = outcomes.indexOf("Yes");
      const noIdx = outcomes.indexOf("No");

      insert.run(
        m.id,
        Number(prices[yesIdx] || 0),
        Number(prices[noIdx] || 0)
      );
    }
    console.log("Price history updated:", new Date().toISOString());
  } catch (e) {
    console.error("CRON ERROR:", e);
  }
}

cron.schedule("*/1 * * * *", updatePrices);
updatePrices();

// ----------------------------
// LOGIN
// ----------------------------
app.post("/api/login", (req, res) => {
  const { wallet } = req.body;

  if (!wallet) return res.status(400).json({ error: "Wallet required" });

  let user = db.prepare("SELECT * FROM users WHERE wallet = ?").get(wallet);

  if (!user) {
    db.prepare(`INSERT INTO users (wallet, balance) VALUES (?, 1000)`)
      .run(wallet);

    user = db.prepare("SELECT * FROM users WHERE wallet = ?").get(wallet);
    return res.json({ user, created: true });
  }

  res.json({ user, created: false });
});

// ----------------------------
// SET USERNAME
// ----------------------------
app.post("/api/set-username", (req, res) => {
  const { wallet, username } = req.body;

  if (!wallet || !username)
    return res.status(400).json({ error: "Wallet + username required" });

  const nameTaken = db.prepare(
    "SELECT * FROM users WHERE username = ? AND wallet != ?"
  ).get(username, wallet);

  if (nameTaken)
    return res.status(400).json({ error: "Username already taken" });

  db.prepare("UPDATE users SET username = ? WHERE wallet = ?")
    .run(username, wallet);

  const updated = db.prepare("SELECT * FROM users WHERE wallet = ?").get(wallet);
  res.json({ status: "ok", user: updated });
});

// ----------------------------
// MARKETS API
// ----------------------------
app.get("/api/prediction/markets", async (req, res) => {
  try {
    const r = await fetch("https://gamma-api.polymarket.com/markets?limit=500&active=true");
    const data = await r.json();

    const markets = data
      .filter(m => m.outcomes?.includes("Yes") && m.outcomes.includes("No"))
      .map(m => ({
        id: m.id,
        question: m.question || m.title || (m.slug ? m.slug.replace(/-/g, " ") : "Unknown question"),
        yesProb: Number(m.outcomePrices?.[0]),
        noProb: Number(m.outcomePrices?.[1]),
        category: m.category
      }));

    res.json({ markets });
  } catch {
    res.status(500).json({ error: "Failed to load markets" });
  }
});

// ----------------------------
// RANDOM MARKET (WITH FALLBACK TEXT)
// ----------------------------
const GAMMA_URL = "https://gamma-api.polymarket.com/markets?limit=800&active=true";

async function getRandomYesNoMarket() {
  const r = await fetch(GAMMA_URL);
  const data = await r.json();

  const valid = data.filter(m =>
    m.outcomes?.includes("Yes") &&
    m.outcomes.includes("No")
  );

  if (!valid.length) throw new Error("No markets");

  const m = valid[Math.floor(Math.random() * valid.length)];

  const outs = Array.isArray(m.outcomes) ? m.outcomes : JSON.parse(m.outcomes);
  const prices = Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices);

  const yesIdx = outs.indexOf("Yes");
  const noIdx = outs.indexOf("No");

  // 🔥 Fallback text
  const text =
    m.question ||
    m.title ||
    (m.slug ? m.slug.replace(/-/g, " ") : null) ||
    "Unknown question";

  return {
    id: m.id,
    question: text,
    yesProb: Number(prices[yesIdx]),
    noProb: Number(prices[noIdx])
  };
}

app.get("/api/polymarket-question", async (req, res) => {
  try {
    res.json(await getRandomYesNoMarket());
  } catch {
    res.status(500).json({ error: "Failed" });
  }
});

// =====================================================================
// DUEL MODE
// =====================================================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/duel" });

const waitingPlayers = [];
const duels = new Map();
let duelCounter = 1;

const ROUNDS_TOTAL = 5;
const ROUND_TIME_MS = 15000;

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
    answered: [null, null],
    scores: [0, 0],
    currentRound: 0
  };

  duels.set(duelId, duel);

  p1.ws.duelId = duelId;
  p1.ws.playerIndex = 0;
  p2.ws.duelId = duelId;
  p2.ws.playerIndex = 1;

 duel.sockets.forEach(ws =>
  safeSend(ws, {
    type: "round_start",
    round: duel.currentRound,
    totalRounds: ROUNDS_TOTAL,
    question: { text: q.question },   // <-- ВАЖНО!
    roundTime: ROUND_TIME_MS / 1000
  })
);


  startRound(duel);
}

async function startRound(duel) {
  if (duel.currentRound >= ROUNDS_TOTAL) return finishDuel(duel);

  duel.currentRound++;
  duel.answered = [null, null];

  const q = await getRandomYesNoMarket();
  duel.correctAnswer = q.yesProb >= q.noProb ? "yes" : "no";

  duel.sockets.forEach(ws =>
    safeSend(ws, {
      type: "round_start",
      round: duel.currentRound,
      totalRounds: ROUNDS_TOTAL,
      question: q.question,
      roundTime: ROUND_TIME_MS / 1000
    })
  );

  clearTimeout(duel.timer);
  duel.timer = setTimeout(() => endRound(duel), ROUND_TIME_MS);
}

function endRound(duel) {
  const correct = duel.correctAnswer;

  for (let i = 0; i < 2; i++) {
    if (duel.answered[i] === correct) {
      duel.scores[i] += 10;

      db.prepare(
        "UPDATE users SET duel_score = duel_score + 10 WHERE wallet = ?"
      ).run(duel.wallets[i]);
    }
  }

  duel.sockets.forEach((ws, i) =>
    safeSend(ws, {
      type: "round_result",
      correctAnswer: correct,
      yourAnswer: duel.answered[i],
      yourScore: duel.scores[i],
      opponentScore: duel.scores[1 - i]
    })
  );

  setTimeout(() => startRound(duel), 2000);
}

function finishDuel(duel) {
  let winner = "draw";
  if (duel.scores[0] > duel.scores[1]) winner = duel.wallets[0];
  else if (duel.scores[1] > duel.scores[0]) winner = duel.wallets[1];

  duel.sockets.forEach((ws, i) =>
    safeSend(ws, {
      type: "duel_finished",
      yourScore: duel.scores[i],
      opponentScore: duel.scores[1 - i],
      winner
    })
  );

  duels.delete(duel.id);
}

wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "init") {
      waitingPlayers.push({
        ws,
        wallet: msg.wallet,
        username: msg.username
      });

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

  ws.on("close", () => console.log("WS disconnected"));
});

// ----------------------------
// START SERVER
// ----------------------------
const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
