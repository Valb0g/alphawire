# AlphaWire

Crypto news aggregator — filters signal from noise, publishes to Telegram.

Collects from RSS feeds, Telegram channels, and APIs. Filters through Qwen LLM via OpenRouter. Publishes important news in Russian to a Telegram channel.

## Category Legend

- 🔴 Security — hacks, exploits, vulnerabilities
- 🟡 Platform — exchange/protocol launches and closures
- 🟣 Regulatory — government actions, laws, sanctions
- 🔵 On-chain — whale moves, large transfers, DeFi events
- ⚪ General — important crypto news

## Local Setup

### Prerequisites
- Node.js 20+
- A Telegram account (for gramjs userbot)
- A Telegram bot token (create via @BotFather)
- The bot must be **admin** in your target channel with "Post Messages" permission

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

### 3. Get Telegram API credentials
1. Go to https://my.telegram.org
2. Log in → "API development tools"
3. Create a new application
4. Copy `api_id` and `api_hash` to `.env`

### 4. Authenticate Telegram userbot (one-time, run locally)
```bash
npx ts-node src/collectors/telegram.ts
```
Follow the prompts. Copy the printed `TELEGRAM_SESSION` string to `.env`.
> ⚠️ This step MUST be done locally before deploying. The session string is then used headlessly on the server.

### 5. Get OpenRouter API key
1. Go to https://openrouter.ai
2. Create a free account → generate API key
3. Add to `.env` as `OPENROUTER_API_KEY`

### 6. Run locally
```bash
npm run dev
```

## Deploy to Render.com

### 1. Push to GitHub
```bash
git push origin main
```

### 2. Create Render service
1. Go to render.com → New → Background Worker
2. Connect your GitHub repo
3. Render will detect `render.yaml` automatically

### 3. Set environment variables
In Render dashboard → Environment, add all variables marked `sync: false` in `render.yaml`:
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION` (from local auth step)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHANNEL_ID`
- `OPENROUTER_API_KEY`
- `CRYPTOPANIC_TOKEN`

### 4. Set up UptimeRobot (keep-alive)
Render free tier sleeps after 15 minutes of inactivity. Fix:
1. Go to https://uptimerobot.com → free account
2. Add Monitor → HTTP(s)
3. URL: `https://your-render-url.onrender.com/health`
4. Interval: **10 minutes**

This pings the `/health` endpoint every 10 min, keeping the process alive 24/7.

### 5. Deploy
Click "Deploy" in Render dashboard. Check logs for:
```
Health server listening on port 3000
Database initialized
Starting orchestrator...
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `RELEVANCE_THRESHOLD` | Min score (0-10) to publish | `6` |
| `RSS_INTERVAL_MINUTES` | RSS polling interval | `10` |
| `API_INTERVAL_MINUTES` | API polling interval | `10` |
| `TELEGRAM_INTERVAL_MINUTES` | Telegram channels polling | `10` |
| `OPENROUTER_MODEL` | Qwen model on OpenRouter | `minimax/minimax-m2.5:free` |

## Monitoring

- Render dashboard → Logs (live stream)
- UptimeRobot → uptime stats and downtime alerts
- Telegram channel — posts appearing = bot is alive
