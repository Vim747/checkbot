#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════════
//  UPBIT LISTING MONITOR — Railway Edition
//  Checks every second if coins become listed on Upbit (KRW market)
//
//  ENV VARS (set in Railway dashboard):
//    TELEGRAM_BOT_TOKEN  — your bot token from @BotFather
//    TELEGRAM_CHAT_ID    — your numeric chat ID
//    WATCH_LIST          — comma-separated coins (default: FET,GALA,ORDI,MANTA)
//    POLL_INTERVAL       — ms between checks (default: 1000)
// ═══════════════════════════════════════════════════════════════════

const https = require("https");
const http = require("http");

// ─── CONFIGURATION (from env vars) ──────────────────────────────

const DEFAULT_WATCH_LIST = [
  // High market cap
  "FET","GALA","ORDI","FLOKI","DYDX","LDO","EIGEN",
  "AR","WIF","NOT","DOGS","PNUT","NEIRO",
  // Mid cap / trending
  "MORPHO","AIXBT","PEOPLE","CETUS","RON","METIS",
  "CORE","CFX","PIXEL","SUSHI","HMSTR","CATI","GOAT","BOME",
].join(",");
 
const CONFIG = {
  watchList: (process.env.WATCH_LIST || DEFAULT_WATCH_LIST)
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),

  pollInterval: parseInt(process.env.POLL_INTERVAL || "1000", 10),

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
  },

  requestTimeout: 5000,
};

// ─── STATE ──────────────────────────────────────────────────────

const state = {
  cycle: 0,
  totalChecks: 0,
  errors: 0,
  startTime: Date.now(),
  previousMarkets: null,
  detectedCoins: new Set(),
  coinStatus: {},
  newMarkets: [],
};

CONFIG.watchList.forEach((coin) => {
  state.coinStatus[coin] = {
    logo: null,
    candles: null,
    trades: null,
    market: null,
  };
});

// ─── LOGGING (structured for Railway) ───────────────────────────

function log(level, msg, data = {}) {
  const entry = {
    time: new Date().toISOString(),
    level,
    msg,
    ...data,
  };
  console.log(JSON.stringify(entry));
}

// ─── HTTP HELPERS ───────────────────────────────────────────────

function fetch(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const mod = urlObj.protocol === "https:" ? https : http;
    const method = options.method || "GET";

    const req = mod.request(
      urlObj,
      {
        method,
        timeout: CONFIG.requestTimeout,
        headers: {
          "User-Agent": "UpbitMonitor/1.0",
          Accept: "application/json",
        },
      },
      (res) => {
        if (method === "HEAD") {
          resolve({ status: res.statusCode, data: null });
          res.resume();
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, data: body }));
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (res.status !== 200) return { status: res.status, json: null };
  try {
    return { status: res.status, json: JSON.parse(res.data) };
  } catch {
    return { status: res.status, json: null };
  }
}

// ─── CHECK METHODS ──────────────────────────────────────────────

async function checkLogo(coin) {
  try {
    const res = await fetch(`https://static.upbit.com/logos/${coin}.png`, { method: "HEAD" });
    return res.status === 200;
  } catch {
    return "error";
  }
}

async function checkCandles(coin) {
  try {
    const res = await fetchJSON(
      `https://crix-api.upbit.com/v1/crix/candles/days?code=CRIX.UPBIT.KRW-${coin}`
    );
    if (res.json === null) return false;
    return Array.isArray(res.json) && res.json.length > 0;
  } catch {
    return "error";
  }
}

async function checkTrades(coin) {
  try {
    const res = await fetchJSON(
      `https://crix-api.upbit.com/v1/crix/trades/ticks?code=CRIX.UPBIT.KRW-${coin}`
    );
    if (res.json === null) return false;
    return Array.isArray(res.json) && res.json.length > 0;
  } catch {
    return "error";
  }
}

async function checkMarketAll() {
  try {
    const res = await fetchJSON("https://api.upbit.com/v1/market/all");
    if (!res.json || !Array.isArray(res.json)) return null;

    const currentMarkets = new Map();
    res.json.forEach((m) => currentMarkets.set(m.market, m.english_name || m.market));

    if (state.previousMarkets !== null) {
      for (const [market, name] of currentMarkets) {
        if (!state.previousMarkets.has(market)) {
          onNewMarketDetected(market, name);
        }
      }
    }

    state.previousMarkets = new Set(currentMarkets.keys());
    return currentMarkets;
  } catch {
    return null;
  }
}

// ─── MAIN SCAN ──────────────────────────────────────────────────

async function scan() {
  state.cycle++;

  try {
    const [marketMap] = await Promise.all([
      checkMarketAll(),
      ...CONFIG.watchList.map((coin) => scanCoin(coin)),
    ]);

    CONFIG.watchList.forEach((coin) => {
      if (marketMap) {
        const found = marketMap.has(`KRW-${coin}`);
        state.coinStatus[coin].market = found;
        if (found) onCoinDetected(coin, "Market List");
      } else {
        state.coinStatus[coin].market = "error";
      }
    });

    state.totalChecks += CONFIG.watchList.length * 4 + 1;

    // Status log every 60 cycles (once per minute)
    if (state.cycle % 60 === 0) {
      const statusSummary = CONFIG.watchList.map((coin) => {
        const s = state.coinStatus[coin];
        const any = s.logo === true || s.candles === true || s.trades === true || s.market === true;
        return `${coin}:${any ? "LISTED" : "waiting"}`;
      });
      log("info", "Status update", {
        cycle: state.cycle,
        checks: state.totalChecks,
        errors: state.errors,
        markets: state.previousMarkets ? state.previousMarkets.size : 0,
        coins: statusSummary,
      });
    }
  } catch (err) {
    state.errors++;
    log("error", "Scan cycle failed", { error: err.message });
  }
}

async function scanCoin(coin) {
  const [logo, candles, trades] = await Promise.all([
    checkLogo(coin),
    checkCandles(coin),
    checkTrades(coin),
  ]);

  state.coinStatus[coin].logo = logo;
  state.coinStatus[coin].candles = candles;
  state.coinStatus[coin].trades = trades;

  if (logo === "error") state.errors++;
  if (candles === "error") state.errors++;
  if (trades === "error") state.errors++;

  if (logo === true) onCoinDetected(coin, "Logo HTTP 200");
  if (candles === true) onCoinDetected(coin, "Candles API");
  if (trades === true) onCoinDetected(coin, "Trades API");
}

// ─── DETECTION & NOTIFICATION ───────────────────────────────────

function onCoinDetected(coin, method) {
  if (state.detectedCoins.has(coin)) return;
  state.detectedCoins.add(coin);

  log("alert", `${coin} DETECTED on Upbit`, { coin, method });

  sendTelegram(
    `🚨 *UPBIT LISTING DETECTED*\n\n` +
    `Coin: *${coin}*\n` +
    `Pair: \`KRW-${coin}\`\n` +
    `Method: ${method}\n` +
    `Time: ${new Date().toISOString()}\n` +
    `Cycle: ${state.cycle}`
  );
}

function onNewMarketDetected(market, name) {
  state.newMarkets.push({ market, name });

  log("alert", `New market on Upbit`, { market, name });

  sendTelegram(
    `🆕 *NEW UPBIT MARKET*\n\n` +
    `Market: *${market}*\n` +
    `Name: ${name}\n` +
    `Time: ${new Date().toISOString()}`
  );
}

// ─── TELEGRAM ───────────────────────────────────────────────────

function sendTelegram(text) {
  const { botToken, chatId } = CONFIG.telegram;
  if (!botToken || !chatId) return;

  const postData = JSON.stringify({
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  });

  const urlObj = new URL(`https://api.telegram.org/bot${botToken}/sendMessage`);
  const req = https.request(urlObj, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
    },
  });

  req.on("error", (err) => log("error", "Telegram send failed", { error: err.message }));
  req.write(postData);
  req.end();
}

// ─── HEALTH CHECK SERVER (keeps Railway happy) ──────────────────

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    const uptimeSec = Math.floor((Date.now() - state.startTime) / 1000);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "running",
        uptime: uptimeSec,
        cycle: state.cycle,
        totalChecks: state.totalChecks,
        errors: state.errors,
        watching: CONFIG.watchList,
        detected: [...state.detectedCoins],
        newMarkets: state.newMarkets,
        marketCount: state.previousMarkets ? state.previousMarkets.size : 0,
      })
    );
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  log("info", `Health check server on port ${PORT}`);
});

// ─── STARTUP ────────────────────────────────────────────────────

log("info", "Upbit Monitor starting", {
  watchList: CONFIG.watchList,
  pollInterval: CONFIG.pollInterval,
  telegram: CONFIG.telegram.botToken ? "enabled" : "disabled",
});

if (CONFIG.telegram.botToken) {
  sendTelegram(
    `🟢 *Upbit Monitor Started*\n\n` +
    `Watching: ${CONFIG.watchList.join(", ")}\n` +
    `Interval: ${CONFIG.pollInterval}ms`
  );
}

// First scan immediately, then on interval
scan();
setInterval(scan, CONFIG.pollInterval);

// Graceful shutdown
process.on("SIGTERM", () => {
  log("info", "Received SIGTERM, shutting down");
  if (CONFIG.telegram.botToken) {
    sendTelegram("🔴 *Upbit Monitor Stopped*");
  }
  setTimeout(() => process.exit(0), 500);
});
