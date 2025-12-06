import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import cron from "node-cron";
import fetch from "node-fetch";
const db = new Database("./database.sqlite");
import http from "http";
import { WebSocketServer } from "ws";

const app = express();
app.use(express.json());
app.use(cors());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// ----------------------------
// INIT SQLITE
// ----------------------------
const db = await open({
  filename: "./database.sqlite",
  driver: sqlite3.Database
});

// USERS
await db.exec(`
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

// BETS
await db.exec(`
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

// PRICE HISTORY
await db.exec(`
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT,
  yes_price REAL,
  no_price REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

console.log("SQLite DB ready.");

// ----------------------------
// CRON: POLYMARKET PRICE HISTORY
// ----------------------------
async function updatePrices() {
  try {
    const r = await fetch("https://gamma-api.polymarket.com/markets?limit=200&active=true");
    const data = await r.json();

    for (const m of data) {
      if (!m.outcomes?.includes("Yes") || !m.outcomes?.includes("No")) continue;

      let outcomes = typeof m.outcomes === "string" ? JSON.parse(m.outcomes) : m.outcomes;
      let prices = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices;

      const yesIdx = outcomes.indexOf("Yes");
      const noIdx = outcomes.indexIndex("No");

      await db.run(
        `INSERT INTO price_history (market_id, yes_price, no_price)
         VALUES (?, ?, ?)`,
        m.id,
        Number(prices[yesIdx] || 0),
        Number(prices[noIdx] || 0)
      );
    }

    console.log("Price history updated:", new Date().toISOString());
  } catch (err) {
    console.error("Price update failed:", err);
  }
}

cron.schedule("*/1 * * * *", updatePrices);
updatePrices();

// ----------------------------
// LOGIN
// ----------------------------
app.post("/api/login", async (req, res) => {
  try {
    const { wallet, username } = req.body;

    if (!wallet || !username)
      return res.status(400).json({ error: "Wallet + username required" });

    const existing = await db.get(
      "SELECT * FROM users WHERE wallet = ?",
      wallet
    );

    if (existing)
      return res.json({ user: existing, created: false });

    await db.run(
      "INSERT INTO users (wallet, username, balance) VALUES (?, ?, ?)",
      wallet, username, 1000
    );

    const newUser = await db.get(
      "SELECT * FROM users WHERE wallet = ?",
      wallet
    );

    res.json({ user: newUser, created: true });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------
// SET USERNAME
// ----------------------------
app.post("/api/set-username", async (req, res) => {
  const { wallet, username } = req.body;

  if (!wallet || !username)
    return res.status(400).json({ error: "Wallet + username required" });

  const exists = await db.get(
    "SELECT * FROM users WHERE username = ? AND wallet != ?",
    username, wallet
  );

  if (exists)
    return res.status(400).json({ error: "Username already taken" });

  await db.run(
    "UPDATE users SET username = ? WHERE wallet = ?",
    username, wallet
  );

  const user = await db.get(
    "SELECT * FROM users WHERE wallet = ?",
    wallet
  );

  res.json({ status: "ok", user });
});

// ----------------------------
// Market list
// ----------------------------
app.get("/api/prediction/markets", async (req, res) => {
  try {
    const r = await fetch("https://gamma-api.polymarket.com/markets?limit=500&active=true");
    const data = await r.json();

    const markets = data
      .filter(m => m.outcomes?.includes("Yes") && m.outcomes.includes("No"))
      .map(m => {
        let prices = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices;
        return {
          id: m.id,
          question: m.question,
          yesProb: Number(prices[0]),
          noProb: Number(prices[1]),
          category: m.category
        };
      });

    res.json({ markets });
  } catch (e) {
    res.status(500).json({ error: "Failed to load markets" });
  }
});

// ----------------------------
// RANDOM YES/NO QUESTION
// ----------------------------
const GAMMA_URL = "https://gamma-api.polymarket.com/markets?limit=1000&active=true";

async function getRandomYesNoMarket() {
  const r = await fetch(GAMMA_URL);
  const data = await r.json();

  const markets = data
    .filter(m => m.outcomes?.includes("Yes") && m.outcomes.includes("No"))
    .map(m => {
      const outs = typeof m.outcomes === "string" ? JSON.parse(m.outcomes) : m.outcomes;
      const prices = typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices;

      const yesIdx = outs.indexOf("Yes");
      const noIdx = outs.indexOf("No");

      return {
        id: m.id,
        question: m.question,
        yesProb: Number(prices[yesIdx]),
        noProb: Number(prices[noIdx])
      };
    });

  if (!markets.length) throw new Error("No markets");

  return markets[Math.floor(Math.random() * markets.length)];
}

app.get("/api/polymarket-question", async (req, res) => {
  try {
    const q = await getRandomYesNoMarket();
    res.json(q);
  } catch {
    res.status(500).json({ error: "Failed to fetch" });
  }
});

// =====================================================================
//                          DUEL MODE (PvP)
// =====================================================================
const PORT = 4000;
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/duel" });

const waitingPlayers = [];
const duels = new Map();
let duelCounter = 1;

const ROUNDS_TOTAL = 5;
const ROUND_TIME_MS = 15000;

// safe WS send
function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

// create duel
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

  duel.sockets.forEach((ws, idx) =>
    safeSend(ws, {
      type: "match_found",
      opponent: {
        wallet: duel.wallets[1 - idx],
        username: duel.usernames[1 - idx]
      },
      totalRounds: ROUNDS_TOTAL
    })
  );

  startRound(duel);
}

async function startRound(duel) {
  if (duel.currentRound >= ROUNDS_TOTAL) return finishDuel(duel);

  duel.currentRound++;
  duel.answered = [null, null];

  const market = await getRandomYesNoMarket();

  duel.correctAnswer = market.yesProb >= market.noProb ? "yes" : "no";

  duel.sockets.forEach(ws =>
    safeSend(ws, {
      type: "round_start",
      round: duel.currentRound,
      totalRounds: ROUNDS_TOTAL,
      question: { text: market.question },
      roundTime: ROUND_TIME_MS / 1000
    })
  );

  duel.timer && clearTimeout(duel.timer);
  duel.timer = setTimeout(() => endRound(duel), ROUND_TIME_MS);
}

async function endRound(duel) {
  const correct = duel.correctAnswer;

  const deltas = [0, 0];
  for (let i = 0; i < 2; i++) {
    if (duel.answered[i] === correct) {
      duel.scores[i] += 10;
      deltas[i] = 10;
    }
    await db.run(
      "UPDATE users SET duel_score = duel_score + ? WHERE wallet = ?",
      deltas[i],
      duel.wallets[i]
    );
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

// WS events
wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

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

  ws.on("close", () => {
    console.log("WS disconnect");
  });
});

// START
server.listen(PORT, () =>
  console.log(`Backend running on http://localhost:${PORT}`)
);
