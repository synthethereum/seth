import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import cron from "node-cron";
import fetch from "node-fetch";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

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
console.log("SQLite loaded");

// Main users table
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

// ADD avatar column if missing
try {
  db.prepare("ALTER TABLE users ADD COLUMN avatar TEXT").run();
  console.log("Added avatar column");
} catch (e) {
  // Column exists — nothing to do
}

// Bets table
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

// Price history
db.prepare(`
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT,
  yes_price REAL,
  no_price REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`).run();
// Ensure avatar column exists
try {
  db.prepare(`ALTER TABLE users ADD COLUMN avatar TEXT`).run();
  console.log("Added column: avatar");
} catch (e) {
  console.log("Avatar column already exists");
}


// ----------------------------
// IDENTICON AVATAR GENERATOR
// ----------------------------
function generateAvatar(wallet) {
  const hash = crypto.createHash("sha256").update(wallet).digest("hex");

  const colors = ["#14b8a6", "#0ea5e9", "#22c55e", "#a855f7"];
  const bg = "#0f172a";

  const blocks = [];
  for (let i = 0; i < 25; i++) {
    const char = parseInt(hash[i], 16);
    const color = colors[char % colors.length];
    if (char % 2 === 0) blocks.push({ i, color });
  }

  let svg = `
  <svg width="100" height="100" viewBox="0 0 5 5" xmlns="http://www.w3.org/2000/svg">
    <rect width="5" height="5" fill="${bg}"/>
  `;

  blocks.forEach(b => {
    const x = b.i % 5;
    const y = Math.floor(b.i / 5);
    svg += `<rect x="${x}" y="${y}" width="1" height="1" fill="${b.color}" />`;
  });

  svg += `</svg>`;

  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}


// ----------------------------
// CRON – PRICE HISTORY
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

      const outcomes = Array.isArray(m.outcomes)
        ? m.outcomes
        : JSON.parse(m.outcomes);
      const prices = Array.isArray(m.outcomePrices)
        ? m.outcomePrices
        : JSON.parse(m.outcomePrices);

      const yesIdx = outcomes.indexOf("Yes");
      const noIdx = outcomes.indexOf("No");

      insert.run(
        m.id,
        Number(prices[yesIdx] || 0),
        Number(prices[noIdx] || 0)
      );
    }

    console.log("Price history updated");
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
    const avatar = generateAvatar(wallet);

    db.prepare(`
      INSERT INTO users (wallet, balance, avatar)
      VALUES (?, 1000, ?)
    `).run(wallet, avatar);

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

  const taken = db.prepare(
    "SELECT * FROM users WHERE username = ? AND wallet != ?"
  ).get(username, wallet);

  if (taken) return res.status(400).json({ error: "Username already taken" });

  db.prepare("UPDATE users SET username = ? WHERE wallet = ?")
    .run(username, wallet);

  const updated = db.prepare("SELECT * FROM users WHERE wallet = ?").get(wallet);
  res.json({ status: "ok", user: updated });
});

// ----------------------------
// LEADERBOARD
// ----------------------------
app.get("/api/leaderboard", (req, res) => {
  const type = req.query.type === "duel" ? "duel_score" : "score";

  const rows = db.prepare(`
    SELECT username, wallet, ${type} AS score, avatar
    FROM users
    ORDER BY ${type} DESC
    LIMIT 50
  `).all();

  res.json({ leaderboard: rows });
});

// ----------------------------
// RANDOM MARKET API
// ----------------------------
const GAMMA_URL = "https://gamma-api.polymarket.com/markets?limit=800&active=true";

async function getRandomYesNoMarket() {
  const r = await fetch(GAMMA_URL);
  const data = await r.json();

  const valid = data.filter(m =>
    m.outcomes?.includes("Yes") && m.outcomes.includes("No")
  );

  if (!valid.length) {
    return {
      id: "fallback",
      question: "Will ETH be above $1,000 tomorrow?",
      yesProb: 0.5,
      noProb: 0.5
    };
  }

  const m = valid[Math.floor(Math.random() * valid.length)];

  const outs = Array.isArray(m.outcomes) ? m.outcomes : JSON.parse(m.outcomes);
  const prices = Array.isArray(m.outcomePrices)
    ? m.outcomePrices
    : JSON.parse(m.outcomePrices);

  const yesIdx = outs.indexOf("Yes");
  const noIdx = outs.indexOf("No");

  return {
    id: m.id,
    question: m.question || m.title || "Unknown question",
    yesProb: Number(prices[yesIdx]),
    noProb: Number(prices[noIdx])
  };
}

app.get("/api/polymarket-question", async (req, res) => {
  try {
    res.json(await getRandomYesNoMarket());
  } catch (e) {
    res.status(500).json({ error: "Failed" });
  }
});

// =====================================================================
// DUEL MODE (PvP)
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
    currentRound: 0,
    timer: null
  };

  duels.set(duelId, duel);

  p1.ws.duelId = duelId;
  p1.ws.playerIndex = 0;

  p2.ws.duelId = duelId;
  p2.ws.playerIndex = 1;

  duel.sockets.forEach((ws, i) =>
    safeSend(ws, {
      type: "match_found",
      opponent: {
        wallet: duel.wallets[1 - i],
        username: duel.usernames[1 - i]
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

  let q;
  try {
    q = await getRandomYesNoMarket();
  } catch {
    q = {
      id: "fallback",
      question: "Will Bitcoin go up tomorrow?",
      yesProb: 0.5,
      noProb: 0.5
    };
  }

  duel.correctAnswer = q.yesProb >= q.noProb ? "yes" : "no";

  duel.sockets.forEach(ws =>
    safeSend(ws, {
      type: "round_start",
      round: duel.currentRound,
      totalRounds: ROUNDS_TOTAL,
      question: {
        text: q.question,
        yesProb: q.yesProb,
        noProb: q.noProb
      },
      roundTime: ROUND_TIME_MS / 1000
    })
  );

  if (duel.timer) clearTimeout(duel.timer);
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

  if (duel.currentRound >= ROUNDS_TOTAL) {
    setTimeout(() => finishDuel(duel), 2000);
    return;
  }

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

  if (duel.timer) clearTimeout(duel.timer);
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
        if (duel.timer) clearTimeout(duel.timer);
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
