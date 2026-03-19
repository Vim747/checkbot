# Upbit Listing Monitor

Real-time monitor that checks every second if coins become listed on Upbit's KRW market. Sends instant Telegram alerts on detection.

## 4 Detection Methods (all run in parallel)

1. **Logo check** — HEAD request to `static.upbit.com/logos/{COIN}.png`
2. **Candles API** — checks if candle data exists for KRW pair
3. **Trades API** — checks if trade ticks exist for KRW pair
4. **Market list diff** — compares `/v1/market/all` snapshots to detect any new market

## Deploy to Railway

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select this repo
4. Add environment variables in the Railway dashboard:

| Variable | Required | Example |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | `7123456789:AAHxxxxxxxxxx` |
| `TELEGRAM_CHAT_ID` | Yes | `736896729` |
| `WATCH_LIST` | No | `FET,GALA,ORDI,MANTA` |
| `POLL_INTERVAL` | No | `1000` |

5. Deploy — it starts automatically

## Health Check

Visit your Railway URL (e.g. `https://your-app.up.railway.app/health`) to see live status as JSON.

## Local Usage

```bash
export TELEGRAM_BOT_TOKEN="your-token"
export TELEGRAM_CHAT_ID="your-chat-id"
node upbit-monitor.js
```
