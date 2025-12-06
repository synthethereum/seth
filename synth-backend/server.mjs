import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import Database from "better-sqlite3";
import cron from "node-cron";
import http from "http";
import { WebSocketServer } from "ws";

const app = express();
app.use(express.json());
app.use(cors());

// =============================
// DATABASE (better-sqlite3)
// =============================
const db = new Database("./database.sqlite");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT UNIQUE,
  username TEXT,
  duel_score INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  balance INTEGER DEFAULT 1000,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

// =============================
// HELPERS
// =============================
const POLY_URL = "https://gamma-api.polymarket.com/markets?limit=500&active=true";

async function getRandomMarket() {
  const r = await fetch(POLY_URL);
  const data = await r.json();

  const valid = data.filter(m => m.outcomes?.includes("Yes") && m.outcomes.includes("No"));
  if (!valid.length) throw new Error("No markets found");

  const m = valid[Math.floor(Math.random() * valid.length)];

  const outcomes = typeof m.outcomes === "string" ? JSON.parse(m.outcomes) : m.outcomes;
  const prices = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices;

  return {
    id: m.id,
    question: m.question,
    yes: Number(prices[outcomes.indexOf("Yes")] || 0),
    no: Number(prices[outcomes.indexOf("No")] || 0)
  };
}

// =============================
// CRON: PRICE HISTORY
// =============================
async function updatePrices() {
  try {
    const r = await fetch(POLY_URL);
    const data = await r.json();

    data.forEach(m => {
      if (!m.outcomes?.includes("Yes") || !m.outcomes?.includes("No")) return;

      let outcomes = typeof m.outcomes === "string" ? JSON.parse(m.outcomes) : m.outcomes;
      let prices = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices;

      const yesIdx = outcomes.indexOf("Yes");
      const noIdx = outcomes.indexOf("No");

      db.prepare(`
        INSERT INTO price_history (market_id, yes_price, no_price)
        VALUES (?, ?, ?)
      `).run(m.id, Number(prices[yesIdx] || 0), Number(prices[noIdx] || 0));
    });

    console.log("Price history updated:", new Date().toISOString());
  } catch (err) {
    console.error("Price update failed:", err);
  }
}

cron.schedule("*/1 * * * *", updatePrices);
updatePrices();

// =============================
// LOGIN — wallet ONLY
// =============================
app.post("/api/login", (req, res) => {
  const wallet = req.body.wallet?.trim();

  if (!wallet) return res.status(400).json({ error: "Wallet required" });

  let user = db.prepare("SELECT * FROM users WHERE wallet = ?").get(wallet);

  // Create user if not exists
  if (!user) {
    db.prepare("INSERT INTO users (wallet, balance) VALUES (?, ?)").run(wallet, 1000);
    user = db.prepare("SELECT * FROM users WHERE wallet = ?").get(wallet);
    return res.json({ user, created: true });
  }

  res.json({ user, created: false });
});

// =============================
// SET USERNAME
// =============================
app.post("/api/set-username", (req, res) => {
  const { wallet, username } = req.body;

  if (!wallet || !username)
    return res.status(400).json({ error: "Wallet + username required" });

  // Check if username taken
  const exists = db.prepare(
    "SELECT * FROM users WHERE username = ? AND wallet != ?"
  ).get(username, wallet);

  if (exists) return res.status(400).json({ error: "Username already taken" });

  db.prepare("UPDATE users SET username = ? WHERE wallet = ?").run(username, wallet);

  const user = db.prepare("SELECT * FROM users WHERE wallet = ?").get(wallet);
  res.json({ status: "ok", user });
});

// =============================
// RANDOM POLYMARKET QUESTION
// =============================
app.get("/api/polymarket-question", async (req, res) => {
  try {
    const m = await getRandomMarket();
    res.json({
      question: m.question,
      yesProb: m.yes,
      noProb: m.no
    });
  } catch {
    res.status(500).json({ error: "Failed to load question" });
  }
});

// =============================
// DUEL MODE (PvP)
// =============================
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/duel" });

const waiting = [];
const duels = new Map();
const ROUNDS = 5;
const ROUND_TIME = 15000;

// safe send
function sendSafe(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function startRound(duel) {
  duel.currentRound++;

  duel.answered = [null, null];

  if (duel.currentRound > ROUNDS) return finishDuel(duel);

  getRandomMarket().then(m => {
    duel.correct = m.yes >= m.no ? "yes" : "no";

    duel.sockets.forEach(ws => sendSafe(ws, {
      type: "round_start",
      round: duel.currentRound,
      totalRounds: ROUNDS,
      question: { text: m.question },
      roundTime: ROUND_TIME / 1000
    }));

    duel.timer = setTimeout(() => endRound(duel), ROUND_TIME);
  });
}

function endRound(duel) {
  const correct = duel.correct;

  for (let i = 0; i < 2; i++) {
    if (duel.answered[i] === correct) {
      duel.scores[i] += 10;
      db.prepare("UPDATE users SET duel_score = duel_score + 10 WHERE wallet = ?")
        .run(duel.wallets[i]);
    }
  }

  duel.sockets.forEach((ws, i) =>
    sendSafe(ws, {
      type: "round_result",
      correctAnswer: correct,
      yourAnswer: duel.answered[i],
      totalScore: duel.scores[i],
      opponentTotalScore: duel.scores[1 - i]
    })
  );

  setTimeout(() => startRound(duel), 2000);
}

function finishDuel(duel) {
  let winner = "draw";
  if (duel.scores[0] > duel.scores[1]) winner = duel.wallets[0];
  if (duel.scores[1] > duel.scores[0]) winner = duel.wallets[1];

  duel.sockets.forEach((ws, i) => sendSafe(ws, {
    type: "duel_finished",
    yourScore: duel.scores[i],
    opponentScore: duel.scores[1 - i],
    winner
  }));

  duels.delete(duel.id);
}

function createDuel(p1, p2) {
  const duel = {
    id: crypto.randomUUID(),
    sockets: [p1.ws, p2.ws],
    wallets: [p1.wallet, p2.wallet],
    usernames: [p1.username, p2.username],
    currentRound: 0,
    scores: [0, 0],
    answered: [null, null]
  };

  duels.set(duel.id, duel);

  p1.ws.duel = duel.id;
  p1.ws.index = 0;
  p2.ws.duel = duel.id;
  p2.ws.index = 1;

  duel.sockets.forEach((ws, i) =>
    sendSafe(ws, {
      type: "match_found",
      opponent: {
        wallet: duel.wallets[1 - i],
        username: duel.usernames[1 - i]
      },
      totalRounds: ROUNDS
    })
  );

  startRound(duel);
}

// =============================
// WebSocket handler
// =============================
wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "init") {
      waiting.push({ ws, wallet: msg.wallet, username: msg.username });

      sendSafe(ws, { type: "waiting" });

      if (waiting.length >= 2) {
        createDuel(waiting.shift(), waiting.shift());
      }
      return;
    }

    if (msg.type === "answer") {
      const duel = duels.get(ws.duel);
      if (!duel) return;

      duel.answered[ws.index] = msg.choice;

      if (duel.answered[0] !== null && duel.answered[1] !== null) {
        clearTimeout(duel.timer);
        endRound(duel);
      }
    }
  });

  ws.on("close", () => console.log("WS disconnect"));
});

// =============================
// START SERVER
// =============================
server.listen(PORT, () =>
  console.log(`Backend running on http://localhost:${PORT}`)
);
