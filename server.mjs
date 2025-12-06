import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import cron from "node-cron";
import fetch from "node-fetch";
import { open } from "sqlite";
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

// users: один кошелёк = один аккаунт, с прогрессом
await db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT UNIQUE,
  username TEXT,
  score INTEGER DEFAULT 0,       -- очки за обычный квиз
  duel_score INTEGER DEFAULT 0,  -- очки за дуэли
  balance INTEGER DEFAULT 1000,  -- внутриигровой баланс токена
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);
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

await db.exec(`
CREATE TABLE IF NOT EXISTS liquidity_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT,
  yes_liq REAL,
  no_liq REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

console.log("SQLite DB ready.");

// ------------------------------------------------------
// CRON: Обновление истории ликвидности каждые 60 сек
// ------------------------------------------------------

async function updateLiquidity() {
  try {
    const r = await fetch("https://gamma-api.polymarket.com/markets?limit=200&active=true");
    const data = await r.json();

    for (const m of data) {
      if (!m.outcomes?.includes("Yes") || !m.outcomes?.includes("No")) continue;

      const outcomes =
        typeof m.outcomes === "string" ? JSON.parse(m.outcomes) : m.outcomes;

      const prices =
        typeof m.outcomePrices === "string"
          ? JSON.parse(m.outcomePrices)
          : m.outcomePrices;

      const yesIndex = outcomes.indexOf("Yes");
      const noIndex = outcomes.indexOf("No");

      await db.run(
        `INSERT INTO liquidity_history (market_id, yes_liq, no_liq)
         VALUES (?, ?, ?)`,
        m.id,
        prices[yesIndex],
        prices[noIndex]
      );
    }

    console.log("Liquidity updated:", new Date().toISOString());
  } catch (err) {
    console.error("Liquidity update failed:", err);
  }
}

// Запуск каждые 60 сек
cron.schedule("*/1 * * * *", updateLiquidity);

// Первый запуск при старте
updateLiquidity();


// ----------------------------
// LOGIN (кошелёк → юзер)
// ----------------------------
app.post("/api/login", async (req, res) => {
  const { wallet } = req.body;

  if (!wallet || !wallet.startsWith("0x")) {
    return res.status(400).json({ error: "Invalid wallet" });
  }

  let user = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);

  // если нет — создаём с базовым балансом/прогрессом
  if (!user) {
    await db.run(
      "INSERT INTO users (wallet, score, duel_score, balance) VALUES (?, 0, 0, 1000)",
      wallet
    );
    user = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);
  }

  res.json({ status: "ok", user });
});


// ----------------------------
// SET USERNAME (привязка к кошельку)
// ----------------------------
app.post("/api/set-username", async (req, res) => {
  const { wallet, username } = req.body;

  if (!wallet || !username) {
    return res.status(400).json({ error: "Wallet + username required" });
  }

  // Проверяем уникальность никнейма (опционально, но красиво)
  const exists = await db.get(
    "SELECT * FROM users WHERE username = ? AND wallet != ?",
    username,
    wallet
  );

  if (exists) {
    return res.status(400).json({ error: "Username already taken" });
  }

  await db.run(
    "UPDATE users SET username = ? WHERE wallet = ?",
    username,
    wallet
  );

  const user = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);

  res.json({ status: "ok", user });
});

app.get("/api/prediction/market/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const r = await fetch(`https://gamma-api.polymarket.com/markets/${id}`);
    const data = await r.json();

    res.json(data);
  } catch (e) {
    console.error("Market details fetch error:", e);
    res.status(500).json({ error: "Failed to load market" });
  }
});


// ----------------------------
// API: получить пользователя по кошельку
// ----------------------------
app.get("/api/user/:wallet", async (req, res) => {
  const wallet = req.params.wallet;

  const user = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);
  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({ user });
});
app.get("/api/prediction/market-history/:id", async (req, res) => {
  const rows = await db.all(
    `SELECT yes_liq, no_liq, created_at
     FROM liquidity_history
     WHERE market_id = ?
     ORDER BY id ASC`,
    req.params.id
  );

  res.json(rows);
});
app.get("/api/prediction/market-bets/:id", async (req, res) => {
  const rows = await db.all(
    `SELECT * FROM bets 
     WHERE market_id = ?
     ORDER BY created_at ASC`,
    req.params.id
  );
  res.json(rows);
});


// ----------------------------
// API: обновить score (обычный квиз)
// ----------------------------
app.post("/api/update-score", async (req, res) => {
  const { wallet, delta } = req.body;

  if (!wallet || typeof delta !== "number") {
    return res.status(400).json({ error: "Invalid params" });
  }

  await db.run(
    "UPDATE users SET score = score + ? WHERE wallet = ?",
    delta,
    wallet
  );

  const user = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);

  res.json({ status: "ok", user });
});
app.post("/api/prediction/bet", async (req, res) => {
  const { wallet, market_id, question, side, amount, coeff } = req.body;

  if (!wallet || !market_id || !side || !amount) {
    return res.status(400).json({ error: "Missing params" });
  }

  const potential_win = amount * coeff;

  try {
    await db.run(
      `INSERT INTO bets (wallet, market_id, question, side, amount, coeff, potential_win)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      wallet, market_id, question, side, amount, coeff, potential_win
    );

    // списать баланс
    await db.run(
      "UPDATE users SET balance = balance - ? WHERE wallet = ?",
      amount, wallet
    );

    res.json({ status: "ok" });
  } catch (e) {
    console.error("BET ERROR:", e);
    res.status(500).json({ error: "DB error" });
  }
});

app.get("/api/prediction/markets", async (req, res) => {
  try {
    const r = await fetch("https://gamma-api.polymarket.com/markets?limit=100&active=true");
    const data = await r.json();

    const markets = data
      .filter(m => m.outcomes.includes("Yes") && m.outcomes.includes("No"))
      .map(m => ({
        id: m.id,
        question: m.question,
        image: m.image,
        yesProb: JSON.parse(m.outcomePrices)[0],
        noProb: JSON.parse(m.outcomePrices)[1],
        category: m.category
      }));

    res.json({ markets });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch markets" });
  }
});

// ----------------------------
// API: обновить balance (ставки / награды)
// ----------------------------
app.post("/api/update-balance", async (req, res) => {
  const { wallet, delta } = req.body;

  if (!wallet || typeof delta !== "number") {
    return res.status(400).json({ error: "Invalid params" });
  }

  await db.run(
    "UPDATE users SET balance = balance + ? WHERE wallet = ?",
    delta,
    wallet
  );

  const user = await db.get("SELECT * FROM users WHERE wallet = ?", wallet);

  res.json({ status: "ok", user });
});


// ------------------------------------------------------
// REAL POLYMARKET YES/NO QUESTIONS (Gamma API)
// ------------------------------------------------------

const GAMMA_URL =
  "https://gamma-api.polymarket.com/markets?limit=1000&active=true";

const ALLOWED_CATEGORIES = ["crypto", "politics", "US-current-affairs"];

// Хелпер, который возвращает случайный YES/NO рынок
async function getRandomYesNoMarket() {
  const r = await fetch(GAMMA_URL);
  const data = await r.json();

  if (!Array.isArray(data)) {
    throw new Error("Invalid Polymarket response");
  }

  const yesNo = data
    .filter(m => m.outcomes && m.outcomes.includes("Yes"))
    .filter(m => m.outcomes.includes("No"))
    .filter(m => ALLOWED_CATEGORIES.includes(m.category))
    .map(m => {
      const outcomes =
        typeof m.outcomes === "string" ? JSON.parse(m.outcomes) : m.outcomes;
      const prices =
        typeof m.outcomePrices === "string"
          ? JSON.parse(m.outcomePrices)
          : m.outcomePrices;

      const yesIndex = outcomes.indexOf("Yes");
      const noIndex = outcomes.indexOf("No");

      return {
        id: m.id,
        question: m.question,
        image: m.image,
        icon: m.icon,
        category: m.category,
        yesProb: Number(prices[yesIndex]),
        noProb: Number(prices[noIndex])
      };
    });

  if (yesNo.length === 0) {
    throw new Error("No valid markets found");
  }

  const rand = yesNo[Math.floor(Math.random() * yesNo.length)];
  return rand;
}

// HTTP-эндпоинт для соло-игры (как у тебя было)
app.get("/api/polymarket-question", async (req, res) => {
  try {
    const rand = await getRandomYesNoMarket();
    res.json(rand);
  } catch (e) {
    console.error("Gamma fetch error:", e);
    res.status(500).json({ error: "Polymarket fetch failed" });
  }
});


// ----------------------------
// HTTP SERVER + WEBSOCKET (Duel mode)
// ----------------------------
const PORT = 4000;
const server = http.createServer(app);

// WebSocket сервер для дуэлей
const wss = new WebSocketServer({ server, path: "/duel" });

const waitingPlayers = []; // { ws, wallet, username }
const duels = new Map();   // duelId -> duelState
let duelCounter = 1;

const ROUNDS_TOTAL = 5;
const ROUND_TIME_MS = 15000;

// безопасная отправка
function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// создаём дуэль, когда есть двое в очереди
function createDuel(p1, p2) {
  const duelId = "duel-" + duelCounter++;

  const duel = {
    id: duelId,
    players: [p1, p2],
    sockets: [p1.ws, p2.ws],
    wallets: [p1.wallet, p2.wallet],
    usernames: [p1.username, p2.username],
    scores: [0, 0],
    currentRound: 0,
    correctAnswer: null,     // "yes" или "no"
    answered: [null, null],  // ответы игроков
    timer: null
  };

  duels.set(duelId, duel);

  // привяжем метаданные к сокетам
  p1.ws.duelId = duelId;
  p1.ws.playerIndex = 0;
  p2.ws.duelId = duelId;
  p2.ws.playerIndex = 1;

  // уведомляем игроков, что нашёлся матч
  duel.sockets.forEach((ws, idx) => {
    safeSend(ws, {
      type: "match_found",
      duelId,
      opponent: {
        wallet: duel.wallets[1 - idx],
        username: duel.usernames[1 - idx]
      }
    });
  });

  // стартуем первый раунд
  startNextRound(duel);
}

// старт раунда
async function startNextRound(duel) {
  if (duel.currentRound >= ROUNDS_TOTAL) {
    finishDuel(duel);
    return;
  }

  duel.currentRound += 1;
  duel.answered = [null, null];
  duel.correctAnswer = null;

  let market;
  try {
    market = await getRandomYesNoMarket();
  } catch (e) {
    console.error("Failed to get market for duel:", e);
    // если не смогли взять вопрос — завершаем дуэль
    finishDuel(duel);
    return;
  }

  // определяем "правильный" ответ по более высокой вероятности
  duel.correctAnswer =
    Number(market.yesProb) >= Number(market.noProb) ? "yes" : "no";

  // отправляем вопрос обоим
  duel.sockets.forEach(ws => {
    safeSend(ws, {
      type: "round_start",
      duelId: duel.id,
      round: duel.currentRound,
      totalRounds: ROUNDS_TOTAL,
      question: {
        id: market.id,
        text: market.question,
        yesProb: market.yesProb,
        noProb: market.noProb
      },
      roundTime: ROUND_TIME_MS / 1000
    });
  });

  // таймер раунда
  duel.timer && clearTimeout(duel.timer);
  duel.timer = setTimeout(() => {
    endRound(duel);
  }, ROUND_TIME_MS);
}

// проверяем, закончен ли раунд (оба ответили)
function maybeEndRound(duel) {
  if (duel.answered[0] !== null && duel.answered[1] !== null) {
    duel.timer && clearTimeout(duel.timer);
    endRound(duel);
  }
}

// завершение раунда: считаем очки, пишем в БД
async function endRound(duel) {
  const correct = duel.correctAnswer;
  const deltas = [0, 0];

  for (let i = 0; i < 2; i++) {
    if (duel.answered[i] === correct) {
      deltas[i] = 10; // +10 за правильный ответ
    } else {
      deltas[i] = 0;  // ничего за неправильный/отсутствующий
    }
    duel.scores[i] += deltas[i];
  }

  // обновляем duel_score в базе
  try {
    for (let i = 0; i < 2; i++) {
      await db.run(
        "UPDATE users SET duel_score = duel_score + ? WHERE wallet = ?",
        deltas[i],
        duel.wallets[i]
      );
    }
  } catch (e) {
    console.error("Failed to update duel_score:", e);
  }

  // отправляем результат раунда
  duel.sockets.forEach((ws, idx) => {
    safeSend(ws, {
      type: "round_result",
      duelId: duel.id,
      round: duel.currentRound,
      correctAnswer: correct,
      yourAnswer: duel.answered[idx],
      opponentAnswer: duel.answered[1 - idx],
      roundDelta: deltas[idx],
      totalScore: duel.scores[idx],
      opponentTotalScore: duel.scores[1 - idx]
    });
  });

  // через 2 секунды — следующий раунд
  setTimeout(() => {
    startNextRound(duel);
  }, 2000);
}

// финал дуэли
function finishDuel(duel) {
  let winner = "draw";
  if (duel.scores[0] > duel.scores[1]) winner = duel.wallets[0];
  else if (duel.scores[1] > duel.scores[0]) winner = duel.wallets[1];

  duel.sockets.forEach((ws, idx) => {
    safeSend(ws, {
      type: "duel_finished",
      duelId: duel.id,
      yourScore: duel.scores[idx],
      opponentScore: duel.scores[1 - idx],
      winner
    });

    ws.duelId = null;
    ws.playerIndex = null;
  });

  duels.delete(duel.id);
}

// обработка дисконнекта
function handleDisconnect(ws) {
  // если в очереди — убираем
  const idxWait = waitingPlayers.findIndex(p => p.ws === ws);
  if (idxWait !== -1) {
    waitingPlayers.splice(idxWait, 1);
  }

  // если в активной дуэли
  const duelId = ws.duelId;
  if (!duelId) return;

  const duel = duels.get(duelId);
  if (!duel) return;

  const me = ws.playerIndex;
  const other = me === 0 ? 1 : 0;
  const otherWs = duel.sockets[other];

  safeSend(otherWs, {
    type: "opponent_left",
    duelId: duel.id
  });

  duel.timer && clearTimeout(duel.timer);
  duels.delete(duel.id);
}

// ----------------------------
// WebSocket events
// ----------------------------
wss.on("connection", ws => {
  console.log("WS client connected to /duel");

  ws.on("message", async raw => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Первое сообщение от клиента: init
    if (msg.type === "init") {
      const { wallet, username } = msg;

      if (!wallet || !username) {
        safeSend(ws, { type: "error", error: "wallet + username required" });
        return;
      }

      // кладём в очередь
      waitingPlayers.push({ ws, wallet, username });
      safeSend(ws, { type: "waiting", message: "Searching for opponent..." });

      // если уже есть второй игрок — создаём дуэль
      if (waitingPlayers.length >= 2) {
        const p1 = waitingPlayers.shift();
        const p2 = waitingPlayers.shift();
        createDuel(p1, p2);
      }
      return;
    }

    // Ответ игрока
    if (msg.type === "answer") {
      const duelId = ws.duelId;
      const choice = msg.choice; // "yes" или "no"

      const duel = duels.get(duelId);
      if (!duel || !duel.correctAnswer) return;

      const i = ws.playerIndex;
      if (duel.answered[i] !== null) return; // уже отвечал

      if (choice !== "yes" && choice !== "no") return;

      duel.answered[i] = choice;
      maybeEndRound(duel);
    }
  });

  ws.on("close", () => {
    console.log("WS client disconnected from /duel");
    handleDisconnect(ws);
  });
});

// ----------------------------
// START SERVER
// ----------------------------
server.listen(PORT, () =>
  console.log(`SynthETH backend + duel WS running at http://localhost:${PORT}`)
);
