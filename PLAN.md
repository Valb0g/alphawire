# Telegram Crypto News Aggregation Bot — Implementation Plan

## Project Overview

A Node.js/TypeScript Telegram bot that aggregates crypto news from RSS feeds, Telegram channels, and APIs, filters them through Qwen LLM via OpenRouter, and publishes important news to a Telegram channel.

---

## Pre-Implementation Setup

### Directory Structure (Final)

```
crypto-news-bot/
├── src/
│   ├── types/
│   │   └── index.ts
│   ├── config/
│   │   └── index.ts
│   ├── collectors/
│   │   ├── rss.ts
│   │   ├── api.ts
│   │   └── telegram.ts
│   ├── database/
│   │   └── index.ts
│   ├── llm/
│   │   └── filter.ts
│   ├── publisher/
│   │   └── index.ts
│   ├── orchestrator/
│   │   └── index.ts
│   └── utils/
│       ├── logger.ts
│       └── hash.ts
├── data/
│   └── .gitkeep
├── logs/
│   └── .gitkeep
├── .env.example
├── .env
├── .gitignore
├── ecosystem.config.js
├── package.json
├── tsconfig.json
└── README.md
```

---

## Phase 1: Foundation

### Goal
Establish project structure, TypeScript configuration, environment variable loading, shared types and interfaces, logger utility, and hash utility.

### Files to Create

#### `package.json`

```json
{
  "name": "crypto-news-bot",
  "version": "1.0.0",
  "description": "Telegram crypto news aggregation bot",
  "main": "dist/orchestrator/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/orchestrator/index.js",
    "dev": "ts-node src/orchestrator/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "axios": "^1.6.7",
    "better-sqlite3": "^9.4.3",
    "dotenv": "^16.4.4",
    "node-cron": "^3.0.3",
    "rss-parser": "^3.13.0",
    "telegraf": "^4.16.3",
    "telegram": "^2.19.7",
    "input": "^1.0.1",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/node": "^20.11.16",
    "@types/node-cron": "^3.0.11",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
```

#### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### `.gitignore`

```
node_modules/
dist/
.env
data/*.db
logs/*.log
session.json
*.session
```

#### `.env.example`

```
# Telegram Bot (for publishing via telegraf)
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHANNEL_ID=@your_channel_or_-100xxxxxxxxx

# Telegram Userbot (for reading source channels via gramjs)
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your_api_hash_here
TELEGRAM_PHONE=+79001234567
TELEGRAM_SESSION=StringSession_value_here

# OpenRouter API (Qwen LLM)
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx
OPENROUTER_MODEL=qwen/qwen-2.5-72b-instruct:free

# CryptoPanic API
CRYPTOPANIC_TOKEN=your_token_here

# Database
DB_PATH=./data/news.db

# Scoring threshold (0-10, articles above this are published)
RELEVANCE_THRESHOLD=6

# Polling intervals (in minutes)
RSS_INTERVAL_MINUTES=15
API_INTERVAL_MINUTES=10
TELEGRAM_INTERVAL_MINUTES=5
```

#### `src/types/index.ts`

```typescript
export type NewsCategory =
  | 'security'
  | 'platform'
  | 'regulatory'
  | 'onchain'
  | 'general';

export type CollectorSource = 'rss' | 'api' | 'telegram';

export interface RawArticle {
  title: string;
  url: string;
  content: string;        // Full text or description
  publishedAt: Date;
  sourceName: string;     // e.g. "CoinTelegraph", "WuBlockchain"
  sourceType: CollectorSource;
  rawHash: string;        // SHA-256 of (title + url)
}

export interface FilteredArticle {
  rawArticle: RawArticle;
  relevanceScore: number; // 0-10 from LLM
  category: NewsCategory;
  summaryRu: string;      // Russian summary from LLM
  categoryEmoji: string;  // Derived from category
}

export interface StoredArticle {
  id: number;
  rawHash: string;
  title: string;
  url: string;
  sourceName: string;
  sourceType: CollectorSource;
  publishedAt: string;    // ISO string stored in SQLite
  relevanceScore: number | null;
  category: NewsCategory | null;
  summaryRu: string | null;
  published: boolean;     // Whether pushed to Telegram channel
  createdAt: string;      // ISO string
}

export interface LLMFilterRequest {
  title: string;
  content: string;
  sourceName: string;
}

export interface LLMFilterResponse {
  relevanceScore: number;   // 0-10
  category: NewsCategory;
  summaryRu: string;        // 2-3 sentence Russian summary
  reasoning: string;        // LLM's brief reasoning (not published)
}

export interface RssFeedConfig {
  url: string;
  sourceName: string;
}

export interface TelegramSourceChannel {
  username: string;         // e.g. "zachxbt" (without @)
  sourceName: string;       // Human-readable name
}

export interface CryptoPanicPost {
  title: string;
  url: string;
  published_at: string;
  source: {
    title: string;
    domain: string;
  };
  currencies?: Array<{ code: string; title: string }>;
  votes: {
    positive: number;
    negative: number;
    important: number;
  };
}

export interface CoinGeckoNewsItem {
  title: string;
  description: string;
  url: string;
  thumb_2x: string;
  news_site: string;
  updated_at: number; // Unix timestamp
}

export interface AppConfig {
  telegram: {
    botToken: string;
    channelId: string;
    apiId: number;
    apiHash: string;
    phone: string;
    session: string;
  };
  openRouter: {
    apiKey: string;
    model: string;
  };
  cryptoPanic: {
    token: string;
  };
  database: {
    path: string;
  };
  relevanceThreshold: number;
  intervals: {
    rssMinutes: number;
    apiMinutes: number;
    telegramMinutes: number;
  };
}
```

#### `src/config/index.ts`

```typescript
import dotenv from 'dotenv';
import { AppConfig } from '../types/index.js';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export const config: AppConfig = {
  telegram: {
    botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    channelId: requireEnv('TELEGRAM_CHANNEL_ID'),
    apiId: parseInt(requireEnv('TELEGRAM_API_ID'), 10),
    apiHash: requireEnv('TELEGRAM_API_HASH'),
    phone: requireEnv('TELEGRAM_PHONE'),
    session: optionalEnv('TELEGRAM_SESSION', ''),
  },
  openRouter: {
    apiKey: requireEnv('OPENROUTER_API_KEY'),
    model: optionalEnv('OPENROUTER_MODEL', 'qwen/qwen-2.5-72b-instruct:free'),
  },
  cryptoPanic: {
    token: optionalEnv('CRYPTOPANIC_TOKEN', ''),
  },
  database: {
    path: optionalEnv('DB_PATH', './data/news.db'),
  },
  relevanceThreshold: parseFloat(optionalEnv('RELEVANCE_THRESHOLD', '6')),
  intervals: {
    rssMinutes: parseInt(optionalEnv('RSS_INTERVAL_MINUTES', '15'), 10),
    apiMinutes: parseInt(optionalEnv('API_INTERVAL_MINUTES', '10'), 10),
    telegramMinutes: parseInt(optionalEnv('TELEGRAM_INTERVAL_MINUTES', '5'), 10),
  },
};
```

#### `src/utils/logger.ts`

```typescript
import winston from 'winston';
import path from 'path';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return stack
      ? `[${timestamp}] ${level.toUpperCase()}: ${message}\n${stack}`
      : `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  })
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error',
    }),
    new winston.transports.File({
      filename: path.join('logs', 'combined.log'),
    }),
  ],
});
```

#### `src/utils/hash.ts`

```typescript
import crypto from 'crypto';

/**
 * Generates a SHA-256 hash for deduplication.
 * Input is normalized: lowercased, trimmed, whitespace collapsed.
 */
export function generateArticleHash(title: string, url: string): string {
  const normalized = `${title.toLowerCase().trim()}|${url.toLowerCase().trim()}`;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Generates a content-based hash for near-duplicate detection.
 * Uses first 200 chars of content after normalization.
 */
export function generateContentHash(content: string): string {
  const normalized = content
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .substring(0, 200);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
```

#### `data/.gitkeep` and `logs/.gitkeep`

Empty files. Create these directories manually:
```bash
mkdir -p data logs
touch data/.gitkeep logs/.gitkeep
```

### Installation Command

```bash
npm install
```

### Phase 1 Review Checklist

- [ ] Run `npm run typecheck` — zero TypeScript errors
- [ ] Run `node -e "require('./src/config/index.ts')"` — no crash (requires ts-node)
- [ ] Verify all `.env.example` keys are documented
- [ ] Verify `src/types/index.ts` exports all listed interfaces
- [ ] Verify `src/utils/hash.ts` produces consistent SHA-256 output:
  ```bash
  npx ts-node -e "import {generateArticleHash} from './src/utils/hash'; console.log(generateArticleHash('Test', 'https://example.com'));"
  ```
- [ ] Verify logger writes to `logs/combined.log` after first import
- [ ] `data/` and `logs/` directories exist

### Phase 1 Commit Message

```
feat: initialize project foundation with types, config, and utilities

- Add TypeScript project structure with strict mode
- Define all shared interfaces: RawArticle, FilteredArticle, StoredArticle, LLMFilterRequest/Response
- Add AppConfig with environment variable validation
- Add Winston logger with file and console transports
- Add SHA-256 hash utilities for deduplication
```

---

## Phase 2: RSS Collector

### Goal
Fetch all configured RSS feeds, parse them, normalize items into `RawArticle` objects.

### Files to Create

#### `src/collectors/rss.ts`

```typescript
import Parser from 'rss-parser';
import { RawArticle, RssFeedConfig } from '../types/index.js';
import { generateArticleHash } from '../utils/hash.js';
import { logger } from '../utils/logger.js';

// Type augmentation for rss-parser to handle custom fields
type CustomFeed = Record<string, unknown>;
type CustomItem = {
  title?: string;
  link?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
  description?: string;
  pubDate?: string;
  isoDate?: string;
  'content:encoded'?: string;
  'dc:creator'?: string;
};

const RSS_FEEDS: RssFeedConfig[] = [
  { url: 'https://cointelegraph.com/rss/tag/hacks', sourceName: 'CoinTelegraph-Hacks' },
  { url: 'https://cointelegraph.com/rss/tag/security', sourceName: 'CoinTelegraph-Security' },
  { url: 'https://cointelegraph.com/rss/tag/regulation', sourceName: 'CoinTelegraph-Regulation' },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss?category=policy-regulation', sourceName: 'CoinDesk-Regulation' },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss?category=markets', sourceName: 'CoinDesk-Markets' },
  { url: 'https://www.theblock.co/rss.xml', sourceName: 'TheBlock' },
  { url: 'https://thedefiant.io/api/feed', sourceName: 'TheDefiant' },
  { url: 'https://www.chainalysis.com/feed', sourceName: 'Chainalysis' },
  { url: 'https://immunefi.com/blog/rss/', sourceName: 'Immunefi' },
  { url: 'https://wublockchain.substack.com/feed', sourceName: 'WuBlockchain-RSS' },
  { url: 'https://decrypt.co/feed', sourceName: 'Decrypt' },
];

const parser = new Parser<CustomFeed, CustomItem>({
  customFields: {
    item: [
      ['content:encoded', 'content:encoded'],
      ['dc:creator', 'dc:creator'],
    ],
  },
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; CryptoNewsBot/1.0)',
    'Accept': 'application/rss+xml, application/xml, text/xml',
  },
});

/**
 * Extracts the best available text content from an RSS item.
 * Priority: content:encoded > content > contentSnippet > description > summary
 */
function extractContent(item: CustomItem): string {
  const raw =
    item['content:encoded'] ||
    item.content ||
    item.contentSnippet ||
    item.description ||
    item.summary ||
    '';
  // Strip HTML tags
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 2000);
}

/**
 * Parses a date string from an RSS item into a Date object.
 * Falls back to current time if parsing fails.
 */
function parseDate(item: CustomItem): Date {
  const dateStr = item.isoDate ?? item.pubDate;
  if (!dateStr) return new Date();
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Fetches and normalizes a single RSS feed.
 * Returns an empty array on error (logs the error).
 */
export async function fetchRssFeed(feedConfig: RssFeedConfig): Promise<RawArticle[]> {
  try {
    logger.debug(`Fetching RSS feed: ${feedConfig.url}`);
    const feed = await parser.parseURL(feedConfig.url);
    const articles: RawArticle[] = [];

    for (const item of feed.items) {
      const title = item.title?.trim();
      const url = item.link?.trim();

      if (!title || !url) {
        logger.debug(`Skipping RSS item missing title or URL from ${feedConfig.sourceName}`);
        continue;
      }

      const content = extractContent(item);
      const publishedAt = parseDate(item);
      const rawHash = generateArticleHash(title, url);

      articles.push({
        title,
        url,
        content,
        publishedAt,
        sourceName: feedConfig.sourceName,
        sourceType: 'rss',
        rawHash,
      });
    }

    logger.info(`RSS [${feedConfig.sourceName}]: fetched ${articles.length} articles`);
    return articles;
  } catch (error) {
    logger.error(`RSS fetch failed for ${feedConfig.sourceName} (${feedConfig.url}): ${error}`);
    return [];
  }
}

/**
 * Fetches all configured RSS feeds concurrently with a concurrency limit of 3.
 * Returns all normalized RawArticle objects from all feeds combined.
 */
export async function fetchAllRssFeeds(): Promise<RawArticle[]> {
  const CONCURRENCY = 3;
  const allArticles: RawArticle[] = [];

  // Process in batches to respect concurrency limit
  for (let i = 0; i < RSS_FEEDS.length; i += CONCURRENCY) {
    const batch = RSS_FEEDS.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(feedConfig => fetchRssFeed(feedConfig)));

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allArticles.push(...result.value);
      }
      // Errors are already logged inside fetchRssFeed
    }
  }

  logger.info(`RSS collector total: ${allArticles.length} articles from ${RSS_FEEDS.length} feeds`);
  return allArticles;
}
```

### Phase 2 Review Checklist

- [ ] Run `npm run typecheck` — zero TypeScript errors
- [ ] Test single feed fetch:
  ```bash
  npx ts-node -e "
  import { fetchRssFeed } from './src/collectors/rss';
  fetchRssFeed({ url: 'https://decrypt.co/feed', sourceName: 'Decrypt' })
    .then(a => { console.log('Count:', a.length); console.log('First:', JSON.stringify(a[0], null, 2)); });
  "
  ```
- [ ] Verify output contains `title`, `url`, `content`, `publishedAt`, `rawHash`, `sourceType: 'rss'`
- [ ] Test all feeds: `npx ts-node -e "import { fetchAllRssFeeds } from './src/collectors/rss'; fetchAllRssFeeds().then(a => console.log('Total:', a.length));"`
- [ ] Verify no unhandled promise rejections when a feed URL is unreachable (test by temporarily setting a bad URL)
- [ ] Confirm `rawHash` is a 64-character hex string

### Phase 2 Commit Message

```
feat: implement RSS collector for all 11 configured feeds

- Add fetchRssFeed() with HTML stripping and date normalization
- Add fetchAllRssFeeds() with concurrency limit of 3
- Handle missing fields gracefully (title/url validation)
- Support content:encoded, contentSnippet, description fallback chain
- Log per-feed counts and total aggregated count
```

---

## Phase 3: API Collector

### Goal
Integrate CryptoPanic and CoinGecko APIs to collect additional news articles normalized to `RawArticle`.

### Files to Create

#### `src/collectors/api.ts`

```typescript
import axios, { AxiosResponse } from 'axios';
import { RawArticle, CryptoPanicPost, CoinGeckoNewsItem } from '../types/index.js';
import { generateArticleHash } from '../utils/hash.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const CRYPTOPANIC_BASE = 'https://cryptopanic.com/api/v1/posts/';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3/news';

const axiosInstance = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'CryptoNewsBot/1.0',
    'Accept': 'application/json',
  },
});

interface CryptoPanicResponse {
  results: CryptoPanicPost[];
  next: string | null;
}

interface CoinGeckoNewsResponse {
  data: CoinGeckoNewsItem[];
}

/**
 * Fetches important crypto news from CryptoPanic API.
 * Returns empty array if token is not configured or request fails.
 */
export async function fetchCryptoPanic(): Promise<RawArticle[]> {
  if (!config.cryptoPanic.token) {
    logger.warn('CryptoPanic token not configured, skipping');
    return [];
  }

  try {
    const params = new URLSearchParams({
      auth_token: config.cryptoPanic.token,
      public: 'true',
      kind: 'news',
      filter: 'important',
    });

    const response: AxiosResponse<CryptoPanicResponse> = await axiosInstance.get(
      `${CRYPTOPANIC_BASE}?${params.toString()}`
    );

    const posts = response.data?.results ?? [];
    const articles: RawArticle[] = [];

    for (const post of posts) {
      const title = post.title?.trim();
      const url = post.url?.trim();

      if (!title || !url) continue;

      const publishedAt = new Date(post.published_at);
      const content = [
        `Source: ${post.source.title} (${post.source.domain})`,
        `Currencies: ${(post.currencies ?? []).map(c => c.code).join(', ') || 'N/A'}`,
        `Votes — Positive: ${post.votes.positive}, Negative: ${post.votes.negative}, Important: ${post.votes.important}`,
      ].join('\n');

      articles.push({
        title,
        url,
        content,
        publishedAt,
        sourceName: `CryptoPanic:${post.source.title}`,
        sourceType: 'api',
        rawHash: generateArticleHash(title, url),
      });
    }

    logger.info(`CryptoPanic: fetched ${articles.length} articles`);
    return articles;
  } catch (error) {
    logger.error(`CryptoPanic fetch failed: ${error}`);
    return [];
  }
}

/**
 * Fetches latest crypto news from CoinGecko public API.
 * No API key required for basic access.
 */
export async function fetchCoinGecko(): Promise<RawArticle[]> {
  try {
    const response: AxiosResponse<CoinGeckoNewsResponse> = await axiosInstance.get(COINGECKO_BASE);
    const items = response.data?.data ?? [];
    const articles: RawArticle[] = [];

    for (const item of items) {
      const title = item.title?.trim();
      const url = item.url?.trim();

      if (!title || !url) continue;

      // CoinGecko uses Unix timestamp in seconds
      const publishedAt = new Date(item.updated_at * 1000);
      const content = item.description?.trim() ?? '';

      articles.push({
        title,
        url,
        content,
        publishedAt,
        sourceName: `CoinGecko:${item.news_site}`,
        sourceType: 'api',
        rawHash: generateArticleHash(title, url),
      });
    }

    logger.info(`CoinGecko: fetched ${articles.length} articles`);
    return articles;
  } catch (error) {
    logger.error(`CoinGecko fetch failed: ${error}`);
    return [];
  }
}

/**
 * Fetches from all API sources concurrently.
 */
export async function fetchAllApiSources(): Promise<RawArticle[]> {
  const [cryptoPanicArticles, coinGeckoArticles] = await Promise.allSettled([
    fetchCryptoPanic(),
    fetchCoinGecko(),
  ]);

  const allArticles: RawArticle[] = [];

  if (cryptoPanicArticles.status === 'fulfilled') {
    allArticles.push(...cryptoPanicArticles.value);
  }
  if (coinGeckoArticles.status === 'fulfilled') {
    allArticles.push(...coinGeckoArticles.value);
  }

  logger.info(`API collector total: ${allArticles.length} articles`);
  return allArticles;
}
```

### Phase 3 Review Checklist

- [ ] Run `npm run typecheck` — zero TypeScript errors
- [ ] Test CoinGecko (no token required):
  ```bash
  npx ts-node -e "
  import { fetchCoinGecko } from './src/collectors/api';
  fetchCoinGecko().then(a => { console.log('Count:', a.length); if(a[0]) console.log('First:', JSON.stringify(a[0], null, 2)); });
  "
  ```
- [ ] Verify CoinGecko returns articles with valid `publishedAt` Date objects
- [ ] Test with missing `CRYPTOPANIC_TOKEN` — verify it logs a warning and returns `[]` without crashing
- [ ] Verify all `RawArticle` fields are present and correctly typed
- [ ] Verify `sourceType` is `'api'` for all returned articles

### Phase 3 Commit Message

```
feat: implement API collectors for CryptoPanic and CoinGecko

- Add fetchCryptoPanic() with vote metadata in content field
- Add fetchCoinGecko() with Unix timestamp conversion
- Add fetchAllApiSources() for concurrent aggregation
- Gracefully skip CryptoPanic when token not configured
- Both collectors return empty arrays on error, never throw
```

---

## Phase 4: Database Layer

### Goal
Create the SQLite database schema, implement all CRUD operations, and deduplication logic.

### Files to Create

#### `src/database/index.ts`

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { RawArticle, StoredArticle, FilteredArticle, NewsCategory, CollectorSource } from '../types/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// ============================================================
// EXACT SQLITE SCHEMA
// ============================================================
//
// Table: articles
// ┌──────────────────┬─────────────────┬──────────────────────────┐
// │ Column           │ Type            │ Notes                    │
// ├──────────────────┼─────────────────┼──────────────────────────┤
// │ id               │ INTEGER         │ PRIMARY KEY AUTOINCREMENT │
// │ raw_hash         │ TEXT            │ UNIQUE, SHA-256          │
// │ title            │ TEXT            │ NOT NULL                 │
// │ url              │ TEXT            │ NOT NULL                 │
// │ source_name      │ TEXT            │ NOT NULL                 │
// │ source_type      │ TEXT            │ 'rss'|'api'|'telegram'   │
// │ published_at     │ TEXT            │ ISO 8601 string          │
// │ content_snippet  │ TEXT            │ First 500 chars          │
// │ relevance_score  │ REAL            │ NULL until LLM processes │
// │ category         │ TEXT            │ NULL until LLM processes │
// │ summary_ru       │ TEXT            │ NULL until LLM processes │
// │ published        │ INTEGER         │ 0 or 1 (boolean)         │
// │ llm_processed    │ INTEGER         │ 0 or 1 (boolean)         │
// │ created_at       │ TEXT            │ ISO 8601, auto-set       │
// └──────────────────┴─────────────────┴──────────────────────────┘
//
// Table: publish_log
// ┌──────────────────┬─────────────────┬──────────────────────────┐
// │ id               │ INTEGER         │ PRIMARY KEY AUTOINCREMENT │
// │ article_id       │ INTEGER         │ FK -> articles.id        │
// │ telegram_msg_id  │ INTEGER         │ Telegram message ID      │
// │ published_at     │ TEXT            │ ISO 8601 string          │
// └──────────────────┴─────────────────┴──────────────────────────┘

const CREATE_ARTICLES_TABLE = `
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_hash TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('rss', 'api', 'telegram')),
    published_at TEXT NOT NULL,
    content_snippet TEXT NOT NULL DEFAULT '',
    relevance_score REAL,
    category TEXT CHECK(category IN ('security', 'platform', 'regulatory', 'onchain', 'general')),
    summary_ru TEXT,
    published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0, 1)),
    llm_processed INTEGER NOT NULL DEFAULT 0 CHECK(llm_processed IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const CREATE_PUBLISH_LOG_TABLE = `
  CREATE TABLE IF NOT EXISTS publish_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id),
    telegram_msg_id INTEGER,
    published_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_articles_raw_hash ON articles(raw_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_llm_processed ON articles(llm_processed)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_relevance_score ON articles(relevance_score)`,
];

let db: Database.Database | null = null;

/**
 * Initializes the SQLite database. Creates tables and indexes if they don't exist.
 * Must be called once at application startup before any other DB operations.
 */
export function initDatabase(): void {
  const dbPath = config.database.path;
  const dbDir = path.dirname(dbPath);

  // Ensure data directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  // Create schema
  db.exec(CREATE_ARTICLES_TABLE);
  db.exec(CREATE_PUBLISH_LOG_TABLE);
  for (const indexSql of CREATE_INDEXES) {
    db.exec(indexSql);
  }

  logger.info(`Database initialized at ${dbPath}`);
}

/**
 * Returns the database instance. Throws if initDatabase() was not called first.
 */
function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Checks if an article with the given hash already exists in the database.
 */
export function articleExists(rawHash: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM articles WHERE raw_hash = ?')
    .get(rawHash);
  return row !== undefined;
}

/**
 * Inserts a RawArticle into the database.
 * Silently ignores duplicates (INSERT OR IGNORE).
 * Returns the inserted row's ID, or null if it was a duplicate.
 */
export function insertRawArticle(article: RawArticle): number | null {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO articles
      (raw_hash, title, url, source_name, source_type, published_at, content_snippet)
    VALUES
      (@rawHash, @title, @url, @sourceName, @sourceType, @publishedAt, @contentSnippet)
  `);

  const result = stmt.run({
    rawHash: article.rawHash,
    title: article.title,
    url: article.url,
    sourceName: article.sourceName,
    sourceType: article.sourceType,
    publishedAt: article.publishedAt.toISOString(),
    contentSnippet: article.content.substring(0, 500),
  });

  if (result.changes === 0) {
    logger.debug(`Duplicate article skipped: ${article.rawHash} (${article.title.substring(0, 50)})`);
    return null;
  }

  return result.lastInsertRowid as number;
}

/**
 * Inserts multiple raw articles in a single transaction.
 * Returns the count of newly inserted (non-duplicate) articles.
 */
export function insertRawArticlesBatch(articles: RawArticle[]): number {
  const database = getDb();
  let insertedCount = 0;

  const insertMany = database.transaction((items: RawArticle[]) => {
    for (const article of items) {
      const id = insertRawArticle(article);
      if (id !== null) insertedCount++;
    }
  });

  insertMany(articles);
  logger.info(`Batch insert: ${insertedCount} new articles out of ${articles.length} total`);
  return insertedCount;
}

/**
 * Fetches articles that have not yet been processed by the LLM.
 * Returns up to `limit` articles ordered by published_at DESC.
 * Default limit is 50 to prevent overwhelming the LLM API.
 */
export function getUnprocessedArticles(limit = 50): StoredArticle[] {
  const rows = getDb()
    .prepare(`
      SELECT
        id, raw_hash, title, url, source_name, source_type,
        published_at, relevance_score, category, summary_ru, published, created_at
      FROM articles
      WHERE llm_processed = 0
      ORDER BY published_at DESC
      LIMIT ?
    `)
    .all(limit) as Array<Record<string, unknown>>;

  return rows.map(mapRowToStoredArticle);
}

/**
 * Updates an article with LLM filter results.
 * Sets llm_processed = 1 after update.
 */
export function updateArticleWithLLMResult(
  id: number,
  score: number,
  category: NewsCategory,
  summaryRu: string
): void {
  getDb()
    .prepare(`
      UPDATE articles
      SET
        relevance_score = @score,
        category = @category,
        summary_ru = @summaryRu,
        llm_processed = 1
      WHERE id = @id
    `)
    .run({ score, category, summaryRu, id });
}

/**
 * Marks an article as having been published to the Telegram channel.
 * Also inserts a record into the publish_log table.
 */
export function markArticleAsPublished(articleId: number, telegramMessageId: number): void {
  const database = getDb();

  const markPublished = database.transaction(() => {
    database
      .prepare('UPDATE articles SET published = 1 WHERE id = ?')
      .run(articleId);

    database
      .prepare(`
        INSERT INTO publish_log (article_id, telegram_msg_id)
        VALUES (?, ?)
      `)
      .run(articleId, telegramMessageId);
  });

  markPublished();
}

/**
 * Fetches articles that are LLM-processed, above the relevance threshold,
 * and not yet published to the Telegram channel.
 */
export function getArticlesToPublish(threshold: number): StoredArticle[] {
  const rows = getDb()
    .prepare(`
      SELECT
        id, raw_hash, title, url, source_name, source_type,
        published_at, relevance_score, category, summary_ru, published, created_at
      FROM articles
      WHERE
        llm_processed = 1
        AND published = 0
        AND relevance_score >= ?
      ORDER BY relevance_score DESC, published_at DESC
      LIMIT 20
    `)
    .all(threshold) as Array<Record<string, unknown>>;

  return rows.map(mapRowToStoredArticle);
}

/**
 * Removes articles older than `days` days to prevent unlimited DB growth.
 * Only removes articles that have already been published or have low scores.
 */
export function cleanupOldArticles(days = 7): number {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const result = getDb()
    .prepare(`
      DELETE FROM articles
      WHERE
        created_at < ?
        AND (published = 1 OR (llm_processed = 1 AND relevance_score < 5))
    `)
    .run(cutoffDate.toISOString());

  logger.info(`Cleanup: removed ${result.changes} old articles`);
  return result.changes as number;
}

/**
 * Maps a raw SQLite row to a StoredArticle object.
 */
function mapRowToStoredArticle(row: Record<string, unknown>): StoredArticle {
  return {
    id: row['id'] as number,
    rawHash: row['raw_hash'] as string,
    title: row['title'] as string,
    url: row['url'] as string,
    sourceName: row['source_name'] as string,
    sourceType: row['source_type'] as CollectorSource,
    publishedAt: row['published_at'] as string,
    relevanceScore: row['relevance_score'] as number | null,
    category: row['category'] as NewsCategory | null,
    summaryRu: row['summary_ru'] as string | null,
    published: (row['published'] as number) === 1,
    createdAt: row['created_at'] as string,
  };
}

/**
 * Closes the database connection gracefully.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('Database connection closed');
  }
}

/**
 * Returns database statistics for monitoring.
 */
export function getDatabaseStats(): {
  totalArticles: number;
  unprocessed: number;
  published: number;
  pendingPublish: number;
} {
  const database = getDb();
  return {
    totalArticles: (database.prepare('SELECT COUNT(*) as c FROM articles').get() as { c: number }).c,
    unprocessed: (database.prepare('SELECT COUNT(*) as c FROM articles WHERE llm_processed = 0').get() as { c: number }).c,
    published: (database.prepare('SELECT COUNT(*) as c FROM articles WHERE published = 1').get() as { c: number }).c,
    pendingPublish: (database.prepare(
      'SELECT COUNT(*) as c FROM articles WHERE llm_processed = 1 AND published = 0 AND relevance_score >= 6'
    ).get() as { c: number }).c,
  };
}
```

### Phase 4 Review Checklist

- [ ] Run `npm run typecheck` — zero TypeScript errors
- [ ] Initialize DB and verify schema:
  ```bash
  npx ts-node -e "
  import { initDatabase, getDatabaseStats } from './src/database';
  initDatabase();
  console.log(getDatabaseStats());
  "
  ```
  Expected: `{ totalArticles: 0, unprocessed: 0, published: 0, pendingPublish: 0 }`
- [ ] Test insert and deduplication:
  ```bash
  npx ts-node -e "
  import { initDatabase, insertRawArticle, articleExists, getUnprocessedArticles } from './src/database';
  import { generateArticleHash } from './src/utils/hash';
  initDatabase();
  const article = { title: 'Test', url: 'https://example.com', content: 'Test content', publishedAt: new Date(), sourceName: 'Test', sourceType: 'rss' as const, rawHash: generateArticleHash('Test', 'https://example.com') };
  console.log('Insert 1:', insertRawArticle(article)); // Should print a number
  console.log('Insert 2 (dupe):', insertRawArticle(article)); // Should print null
  console.log('Exists:', articleExists(article.rawHash)); // Should print true
  console.log('Unprocessed:', getUnprocessedArticles().length); // Should print 1
  "
  ```
- [ ] Verify `data/news.db` file created
- [ ] Open DB with sqlite3 CLI and inspect schema: `sqlite3 data/news.db ".schema"`
- [ ] Verify all 5 indexes exist: `sqlite3 data/news.db ".indexes articles"`
- [ ] Test `updateArticleWithLLMResult` and verify `llm_processed = 1` in DB
- [ ] Test `cleanupOldArticles` runs without error

### Phase 4 Commit Message

```
feat: implement SQLite database layer with full CRUD and deduplication

- Define exact schema: articles table with LLM fields, publish_log table
- Add WAL mode, foreign keys, and 5 performance indexes
- Implement insertRawArticlesBatch() with transaction support
- Implement getUnprocessedArticles() for LLM queue
- Implement updateArticleWithLLMResult() and markArticleAsPublished()
- Add cleanupOldArticles() for DB maintenance
- Add getDatabaseStats() for monitoring
```

---

## Phase 5: Telegram Source Reader

### Goal
Use gramjs to authenticate as a userbot and read recent messages from specified Telegram channels, normalizing them into `RawArticle` objects.

### Important Notes for Implementation

- gramjs requires an interactive first-time auth (phone + SMS code). After first auth, save the `StringSession` to `.env` as `TELEGRAM_SESSION`.
- The `session.json` / StringSession approach stores auth permanently.
- Run the auth script once manually before wiring into the main bot.

### Files to Create

#### `src/collectors/telegram.ts`

```typescript
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram/tl/index.js';
import input from 'input';
import { RawArticle, TelegramSourceChannel } from '../types/index.js';
import { generateArticleHash } from '../utils/hash.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const SOURCE_CHANNELS: TelegramSourceChannel[] = [
  { username: 'zachxbt', sourceName: 'ZachXBT' },
  { username: 'peckshieldalert', sourceName: 'PeckShield' },
  { username: 'blocksecteam', sourceName: 'BlockSec' },
  { username: 'whale_alert', sourceName: 'WhaleAlert' },
  { username: 'lookonchain', sourceName: 'LookOnChain' },
  { username: 'wublockchain', sourceName: 'WuBlockchain-TG' },
  { username: 'TheBlock__', sourceName: 'TheBlock-TG' },
];

// Minimum message length to consider as a news item (filter out short reactions/reposts)
const MIN_MESSAGE_LENGTH = 50;

// How many recent messages to fetch per channel per cycle
const MESSAGES_PER_CHANNEL = 20;

let telegramClient: TelegramClient | null = null;

/**
 * Initializes the gramjs TelegramClient with StringSession.
 * On first run (empty session), performs interactive phone authentication.
 * On subsequent runs, restores session from config.
 */
export async function initTelegramClient(): Promise<void> {
  if (telegramClient?.connected) {
    return;
  }

  const session = new StringSession(config.telegram.session);

  telegramClient = new TelegramClient(
    session,
    config.telegram.apiId,
    config.telegram.apiHash,
    {
      connectionRetries: 5,
      retryDelay: 1000,
      autoReconnect: true,
      useWSS: false,
    }
  );

  await telegramClient.start({
    phoneNumber: async () => config.telegram.phone,
    password: async () => await input.text('Enter 2FA password (if enabled): '),
    phoneCode: async () => await input.text('Enter the verification code sent to your phone: '),
    onError: (err: Error) => {
      logger.error(`Telegram auth error: ${err.message}`);
    },
  });

  // Save the session string for future use
  const sessionString = (session as StringSession).save();
  if (sessionString !== config.telegram.session) {
    logger.warn(`New Telegram session generated. Add to .env:\nTELEGRAM_SESSION=${sessionString}`);
    console.log(`\n\nSAVE THIS TO .env: TELEGRAM_SESSION=${sessionString}\n\n`);
  }

  logger.info('Telegram userbot client connected');
}

/**
 * Fetches recent messages from a single Telegram channel.
 * Returns normalized RawArticle objects.
 */
async function fetchChannelMessages(channel: TelegramSourceChannel): Promise<RawArticle[]> {
  if (!telegramClient?.connected) {
    throw new Error('Telegram client not initialized');
  }

  try {
    const messages = await telegramClient.getMessages(channel.username, {
      limit: MESSAGES_PER_CHANNEL,
    });

    const articles: RawArticle[] = [];

    for (const message of messages) {
      // Skip service messages, empty messages, and short messages
      if (!message.message || message.message.length < MIN_MESSAGE_LENGTH) {
        continue;
      }

      const text = message.message.trim();
      const messageDate = new Date((message.date ?? 0) * 1000);
      const messageId = message.id;

      // Generate a pseudo-URL for deduplication (Telegram messages don't have real URLs)
      const pseudoUrl = `https://t.me/${channel.username}/${messageId}`;

      // Use first line or first 100 chars as title
      const firstLine = text.split('\n')[0] ?? '';
      const title = firstLine.length > 10
        ? firstLine.substring(0, 120)
        : text.substring(0, 120);

      const rawHash = generateArticleHash(title, pseudoUrl);

      articles.push({
        title,
        url: pseudoUrl,
        content: text.substring(0, 2000),
        publishedAt: messageDate,
        sourceName: channel.sourceName,
        sourceType: 'telegram',
        rawHash,
      });
    }

    logger.debug(`Telegram [${channel.sourceName}]: fetched ${articles.length} messages`);
    return articles;
  } catch (error) {
    logger.error(`Failed to fetch from Telegram channel ${channel.username}: ${error}`);
    return [];
  }
}

/**
 * Fetches messages from all configured source channels sequentially.
 * Sequential (not concurrent) to avoid Telegram flood limits.
 * Adds a 1-second delay between channels.
 */
export async function fetchAllTelegramChannels(): Promise<RawArticle[]> {
  if (!telegramClient?.connected) {
    logger.warn('Telegram client not connected, skipping channel fetch');
    return [];
  }

  const allArticles: RawArticle[] = [];

  for (const channel of SOURCE_CHANNELS) {
    const articles = await fetchChannelMessages(channel);
    allArticles.push(...articles);

    // Delay to avoid Telegram flood limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  logger.info(`Telegram collector total: ${allArticles.length} messages from ${SOURCE_CHANNELS.length} channels`);
  return allArticles;
}

/**
 * Disconnects the Telegram client gracefully.
 */
export async function disconnectTelegramClient(): Promise<void> {
  if (telegramClient?.connected) {
    await telegramClient.disconnect();
    telegramClient = null;
    logger.info('Telegram userbot client disconnected');
  }
}
```

### Phase 5 Review Checklist

- [ ] Run `npm run typecheck` — zero TypeScript errors
- [ ] Perform first-time auth manually:
  ```bash
  npx ts-node -e "
  import { initTelegramClient, fetchAllTelegramChannels, disconnectTelegramClient } from './src/collectors/telegram';
  (async () => {
    await initTelegramClient();
    const articles = await fetchAllTelegramChannels();
    console.log('Total:', articles.length);
    if (articles[0]) console.log('First:', JSON.stringify(articles[0], null, 2));
    await disconnectTelegramClient();
  })();
  "
  ```
- [ ] Copy the printed `TELEGRAM_SESSION` value to `.env`
- [ ] Run the command again (second time) — should NOT prompt for phone code (session restored)
- [ ] Verify returned articles have `sourceType: 'telegram'`
- [ ] Verify `url` follows `https://t.me/username/messageId` pattern
- [ ] Verify messages shorter than 50 chars are filtered out
- [ ] Verify no crash when a channel is inaccessible (private channel or wrong username)

### Phase 5 Commit Message

```
feat: implement Telegram userbot channel reader via gramjs

- Add initTelegramClient() with StringSession persistence
- Add fetchChannelMessages() with flood-limit delay
- Add fetchAllTelegramChannels() for sequential multi-channel fetch
- Filter short messages (< 50 chars), normalize to RawArticle
- Generate pseudo-URLs (t.me/channel/msgId) for deduplication
- Print session string on first auth for .env storage
```

---

## Phase 6: LLM Filter

### Goal
Send unprocessed articles to Qwen via OpenRouter, get relevance scores, category classification, and Russian summaries.

### Exact LLM Prompt Template

The prompt is the most critical part of this phase. The following is the exact prompt to use:

```
SYSTEM PROMPT:
You are a crypto news relevance analyst. Your task is to evaluate a news article and return a structured JSON response.

Evaluate the article on the following criteria:
1. Is it about significant crypto events (hacks, exploits, regulatory actions, major launches/closures, whale movements, important on-chain events)?
2. Is it factual and newsworthy (not an opinion piece, tutorial, or advertisement)?
3. Would it be important for a professional crypto trader or developer to know?

Categories:
- "security": hacks, exploits, vulnerabilities, stolen funds, smart contract bugs, rug pulls, phishing, fraud
- "platform": exchange launches/closures, protocol launches/upgrades, DeFi/NFT platform news, CEX/DEX events
- "regulatory": laws, bans, SEC/CFTC/government actions, legal proceedings, sanctions, compliance
- "onchain": whale movements, large transfers, on-chain analytics, liquidations, unusual on-chain activity
- "general": important crypto news that doesn't fit the above (market crashes, major partnerships, bitcoin ETF, macro events)

Relevance score (0-10):
- 9-10: Critical breaking news (major hack >$10M, major regulatory ban, exchange collapse)
- 7-8: Important news (significant hack <$10M, new regulations, major protocol launch)
- 5-6: Notable but not urgent (medium whale moves, smaller platform news)
- 3-4: Minor news (small updates, minor platform changes)
- 1-2: Low relevance (opinion, minor price updates, ads)
- 0: Not crypto news or spam

Return ONLY valid JSON with this exact structure:
{
  "relevanceScore": <number 0-10>,
  "category": "<security|platform|regulatory|onchain|general>",
  "summaryRu": "<2-3 sentence summary in Russian language>",
  "reasoning": "<1 sentence explaining your score in English>"
}

USER PROMPT:
Article Title: {TITLE}
Source: {SOURCE_NAME}
Content: {CONTENT}

Analyze this article and return the JSON response.
```

### Files to Create

#### `src/llm/filter.ts`

```typescript
import axios, { AxiosResponse } from 'axios';
import {
  LLMFilterRequest,
  LLMFilterResponse,
  NewsCategory,
  StoredArticle,
} from '../types/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Delay between LLM API calls to respect rate limits (free tier)
const INTER_REQUEST_DELAY_MS = 2000;

// Maximum content length to send to LLM (to stay within context window)
const MAX_CONTENT_LENGTH = 1500;

const SYSTEM_PROMPT = `You are a crypto news relevance analyst. Your task is to evaluate a news article and return a structured JSON response.

Evaluate the article on the following criteria:
1. Is it about significant crypto events (hacks, exploits, regulatory actions, major launches/closures, whale movements, important on-chain events)?
2. Is it factual and newsworthy (not an opinion piece, tutorial, or advertisement)?
3. Would it be important for a professional crypto trader or developer to know?

Categories:
- "security": hacks, exploits, vulnerabilities, stolen funds, smart contract bugs, rug pulls, phishing, fraud
- "platform": exchange launches/closures, protocol launches/upgrades, DeFi/NFT platform news, CEX/DEX events
- "regulatory": laws, bans, SEC/CFTC/government actions, legal proceedings, sanctions, compliance
- "onchain": whale movements, large transfers, on-chain analytics, liquidations, unusual on-chain activity
- "general": important crypto news that doesn't fit the above (market crashes, major partnerships, bitcoin ETF, macro events)

Relevance score (0-10):
- 9-10: Critical breaking news (major hack >$10M, major regulatory ban, exchange collapse)
- 7-8: Important news (significant hack <$10M, new regulations, major protocol launch)
- 5-6: Notable but not urgent (medium whale moves, smaller platform news)
- 3-4: Minor news (small updates, minor platform changes)
- 1-2: Low relevance (opinion, minor price updates, ads)
- 0: Not crypto news or spam

Return ONLY valid JSON with this exact structure:
{
  "relevanceScore": <number 0-10>,
  "category": "<security|platform|regulatory|onchain|general>",
  "summaryRu": "<2-3 sentence summary in Russian language>",
  "reasoning": "<1 sentence explaining your score in English>"
}`;

function buildUserPrompt(request: LLMFilterRequest): string {
  const truncatedContent = request.content.substring(0, MAX_CONTENT_LENGTH);
  return `Article Title: ${request.title}
Source: ${request.sourceName}
Content: ${truncatedContent}

Analyze this article and return the JSON response.`;
}

const VALID_CATEGORIES = new Set<NewsCategory>([
  'security', 'platform', 'regulatory', 'onchain', 'general',
]);

/**
 * Validates and sanitizes the LLM response JSON.
 * Returns null if the response is invalid or cannot be parsed.
 */
function parseAndValidateLLMResponse(rawText: string): LLMFilterResponse | null {
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn(`LLM response contains no JSON: ${rawText.substring(0, 200)}`);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const score = Number(parsed['relevanceScore']);
    if (isNaN(score) || score < 0 || score > 10) {
      logger.warn(`LLM returned invalid relevanceScore: ${parsed['relevanceScore']}`);
      return null;
    }

    const category = parsed['category'] as string;
    if (!VALID_CATEGORIES.has(category as NewsCategory)) {
      logger.warn(`LLM returned invalid category: ${category}`);
      return null;
    }

    const summaryRu = String(parsed['summaryRu'] ?? '').trim();
    if (summaryRu.length < 10) {
      logger.warn(`LLM returned empty summaryRu`);
      return null;
    }

    return {
      relevanceScore: score,
      category: category as NewsCategory,
      summaryRu,
      reasoning: String(parsed['reasoning'] ?? ''),
    };
  } catch (error) {
    logger.warn(`Failed to parse LLM response JSON: ${error}`);
    return null;
  }
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature: number;
  max_tokens: number;
  response_format?: { type: 'json_object' };
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

/**
 * Sends a single article to Qwen via OpenRouter for relevance filtering.
 * Returns null if the LLM call fails or returns invalid data.
 * Implements retry logic with 1 retry on failure.
 */
export async function filterArticleWithLLM(
  request: LLMFilterRequest,
  retries = 1
): Promise<LLMFilterResponse | null> {
  const requestBody: OpenRouterRequest = {
    model: config.openRouter.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(request) },
    ],
    temperature: 0.1,  // Low temperature for consistent structured output
    max_tokens: 300,
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response: AxiosResponse<OpenRouterResponse> = await axios.post(
        OPENROUTER_API_URL,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${config.openRouter.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/crypto-news-bot',
            'X-Title': 'Crypto News Bot',
          },
          timeout: 30000,
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) {
        logger.warn(`LLM returned empty content for: ${request.title.substring(0, 50)}`);
        continue;
      }

      const result = parseAndValidateLLMResponse(content);
      if (result) {
        logger.debug(
          `LLM scored "${request.title.substring(0, 50)}" → ${result.relevanceScore}/10 [${result.category}]`
        );
        return result;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        logger.error(`LLM API error (status ${status}): ${error.message}`);

        // Don't retry on client errors (400, 401, 422)
        if (status && status >= 400 && status < 500) {
          return null;
        }
      } else {
        logger.error(`LLM unexpected error: ${error}`);
      }

      if (attempt < retries) {
        logger.info(`Retrying LLM call (attempt ${attempt + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  return null;
}

/**
 * Processes a batch of unprocessed articles through the LLM filter.
 * Applies inter-request delay to respect free tier rate limits.
 * Returns array of articles with their LLM results.
 */
export async function filterArticlesBatch(
  articles: StoredArticle[]
): Promise<Array<{ article: StoredArticle; result: LLMFilterResponse | null }>> {
  const results: Array<{ article: StoredArticle; result: LLMFilterResponse | null }> = [];

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i]!;

    logger.debug(`Processing LLM filter ${i + 1}/${articles.length}: ${article.title.substring(0, 60)}`);

    const llmRequest: LLMFilterRequest = {
      title: article.title,
      content: article.summaryRu ?? article.title, // Use stored content snippet
      sourceName: article.sourceName,
    };

    // Note: StoredArticle doesn't have full content — we use content_snippet from DB
    // The orchestrator must pass the full content from RawArticle when available
    const result = await filterArticleWithLLM(llmRequest);
    results.push({ article, result });

    // Rate limiting delay (skip after last item)
    if (i < articles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, INTER_REQUEST_DELAY_MS));
    }
  }

  const successCount = results.filter(r => r.result !== null).length;
  logger.info(`LLM filter complete: ${successCount}/${articles.length} articles processed successfully`);

  return results;
}
```

#### Important Implementation Note

The `StoredArticle` returned from the DB only has a 500-char snippet of content. In the orchestrator (Phase 8), when calling `filterArticleWithLLM`, pass the full content from `RawArticle` if it's still in memory, or accept that the 500-char snippet is sufficient for scoring. For the batch processor used later, the snippet is sufficient.

For the `filterArticlesBatch` function, update the `llmRequest` content source:

```typescript
// In orchestrator, when content is available from RawArticle:
const llmRequest: LLMFilterRequest = {
  title: article.title,
  content: fullContent ?? article.summaryRu ?? article.title,
  sourceName: article.sourceName,
};
```

### Phase 6 Review Checklist

- [ ] Run `npm run typecheck` — zero TypeScript errors
- [ ] Test with a real article:
  ```bash
  npx ts-node -e "
  import { filterArticleWithLLM } from './src/llm/filter';
  filterArticleWithLLM({
    title: 'Bybit hacked for \$1.5 billion in ETH',
    content: 'Bybit exchange confirmed a hack resulting in the theft of approximately 1.5 billion USD worth of Ethereum. The attack appears to have originated from a compromised cold wallet.',
    sourceName: 'CoinTelegraph'
  }).then(r => console.log(JSON.stringify(r, null, 2)));
  "
  ```
  Expected: `relevanceScore` 9-10, `category: 'security'`, Russian summary present
- [ ] Test with non-crypto content:
  ```bash
  npx ts-node -e "
  import { filterArticleWithLLM } from './src/llm/filter';
  filterArticleWithLLM({
    title: 'Top 10 pizza recipes for 2024',
    content: 'Here are the best pizza recipes...',
    sourceName: 'RandomBlog'
  }).then(r => console.log('Score:', r?.relevanceScore)); // Expect 0-1
  "
  ```
- [ ] Verify OpenRouter API key is valid (HTTP 200 response)
- [ ] Verify `summaryRu` contains Cyrillic characters (is actually in Russian)
- [ ] Verify JSON parsing handles code block wrapping (``` json blocks)
- [ ] Test rate limiting: process 3 articles and verify ~4 second gaps in logs
- [ ] Verify invalid responses return `null` without crashing

### Phase 6 Commit Message

```
feat: implement Qwen LLM filter via OpenRouter with scoring and Russian summaries

- Add filterArticleWithLLM() with exact system prompt for category/score/summary
- Add parseAndValidateLLMResponse() with JSON extraction from markdown blocks
- Add filterArticlesBatch() with 2s inter-request delay for free tier limits
- Support retry logic (1 retry) with 3s delay on server errors
- Validate all LLM response fields: score range, category enum, Russian summary length
- Temperature set to 0.1 for consistent structured JSON output
```

---

## Phase 7: Telegram Publisher

### Goal
Use telegraf to format and publish filtered articles to the Telegram channel with category emoji, Russian summary, and source link.

### Exact Message Format Template

```
{EMOJI} {TITLE}

{SUMMARY_RU}

🔗 {SOURCE_NAME} | {URL}
```

**Example output:**
```
🔴 Bybit Hacked for $1.5B in ETH

Биржа Bybit подверглась взлому, в результате которого были похищены активы на сумму около 1,5 миллиарда долларов в Ethereum. Атака была осуществлена через скомпрометированный холодный кошелек. Расследование продолжается, средства пользователей пока заморожены.

🔗 CoinTelegraph | https://cointelegraph.com/news/bybit-hacked
```

### Category Emoji Mapping

| Category | Emoji | Meaning |
|----------|-------|---------|
| security | 🔴 | Security/hacks/exploits |
| platform | 🟡 | Platform launches/closures |
| regulatory | 🟣 | Regulatory events |
| onchain | 🔵 | On-chain events/whale moves |
| general | ⚪ | General important crypto news |

### Files to Create

#### `src/publisher/index.ts`

```typescript
import { Telegraf } from 'telegraf';
import { StoredArticle, NewsCategory } from '../types/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const CATEGORY_EMOJI: Record<NewsCategory, string> = {
  security: '🔴',
  platform: '🟡',
  regulatory: '🟣',
  onchain: '🔵',
  general: '⚪',
};

// Telegram message length limit is 4096 characters
const TELEGRAM_MAX_LENGTH = 4096;

// Delay between consecutive publish operations (ms) to avoid flood limits
const PUBLISH_DELAY_MS = 1500;

let bot: Telegraf | null = null;

/**
 * Initializes the Telegraf bot instance.
 * Must be called before any publish operations.
 */
export function initPublisher(): void {
  bot = new Telegraf(config.telegram.botToken);
  logger.info('Telegram publisher (Telegraf) initialized');
}

/**
 * Formats a StoredArticle into the exact Telegram message format.
 * Applies Telegram MarkdownV2 escaping for special characters.
 *
 * Format:
 * {EMOJI} {TITLE}
 * (blank line)
 * {SUMMARY_RU}
 * (blank line)
 * 🔗 {SOURCE_NAME} | {URL}
 */
export function formatMessage(article: StoredArticle): string {
  const emoji = CATEGORY_EMOJI[article.category ?? 'general'];
  const title = article.title.trim();
  const summary = (article.summaryRu ?? 'Краткое содержание недоступно.').trim();
  const sourceName = article.sourceName.split(':').pop() ?? article.sourceName; // Clean "CryptoPanic:TheBlock" -> "TheBlock"
  const url = article.url;

  const message = `${emoji} ${title}\n\n${summary}\n\n🔗 ${sourceName} | ${url}`;

  // Truncate if over limit (rare but safe)
  if (message.length > TELEGRAM_MAX_LENGTH) {
    const truncatedSummary = summary.substring(0, TELEGRAM_MAX_LENGTH - 200) + '...';
    return `${emoji} ${title}\n\n${truncatedSummary}\n\n🔗 ${sourceName} | ${url}`;
  }

  return message;
}

/**
 * Publishes a single article to the configured Telegram channel.
 * Returns the Telegram message ID on success, null on failure.
 *
 * Uses HTML parse mode to preserve URLs as clickable links.
 * Disables web page preview to keep messages compact.
 */
export async function publishArticle(article: StoredArticle): Promise<number | null> {
  if (!bot) {
    throw new Error('Publisher not initialized. Call initPublisher() first.');
  }

  if (!article.summaryRu || !article.category) {
    logger.warn(`Skipping article ${article.id} — missing summaryRu or category`);
    return null;
  }

  const messageText = formatMessage(article);

  try {
    const sentMessage = await bot.telegram.sendMessage(
      config.telegram.channelId,
      messageText,
      {
        disable_web_page_preview: true,
        parse_mode: undefined, // Plain text — no markdown to avoid escaping issues
      }
    );

    logger.info(
      `Published article ${article.id} to channel. Telegram msg ID: ${sentMessage.message_id}. Title: ${article.title.substring(0, 50)}`
    );

    return sentMessage.message_id;
  } catch (error) {
    logger.error(`Failed to publish article ${article.id}: ${error}`);
    return null;
  }
}

/**
 * Publishes multiple articles sequentially with delay between each.
 * Returns a map of article ID -> Telegram message ID (null if failed).
 */
export async function publishArticlesBatch(
  articles: StoredArticle[]
): Promise<Map<number, number | null>> {
  const results = new Map<number, number | null>();

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i]!;
    const msgId = await publishArticle(article);
    results.set(article.id, msgId);

    // Delay between publishes to avoid flood limits
    if (i < articles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, PUBLISH_DELAY_MS));
    }
  }

  const successCount = [...results.values()].filter(v => v !== null).length;
  logger.info(`Publish batch complete: ${successCount}/${articles.length} published successfully`);

  return results;
}

/**
 * Sends a status/health message to the channel (for monitoring).
 * Used by the orchestrator for startup notifications.
 */
export async function sendStatusMessage(text: string): Promise<void> {
  if (!bot) return;
  try {
    await bot.telegram.sendMessage(config.telegram.channelId, `ℹ️ ${text}`, {
      disable_web_page_preview: true,
    });
  } catch (error) {
    logger.error(`Failed to send status message: ${error}`);
  }
}

/**
 * Tests the publisher by sending a test message.
 * Use this during Phase 7 review to verify bot permissions.
 */
export async function testPublisher(): Promise<boolean> {
  if (!bot) {
    initPublisher();
  }
  try {
    await bot!.telegram.sendMessage(
      config.telegram.channelId,
      '✅ Crypto News Bot connected and ready.'
    );
    logger.info('Publisher test message sent successfully');
    return true;
  } catch (error) {
    logger.error(`Publisher test failed: ${error}`);
    return false;
  }
}
```

### Phase 7 Review Checklist

- [ ] Run `npm run typecheck` — zero TypeScript errors
- [ ] Verify bot token is valid and bot is admin in the channel
- [ ] Test publisher:
  ```bash
  npx ts-node -e "
  import { testPublisher } from './src/publisher';
  testPublisher().then(ok => console.log('Success:', ok));
  "
  ```
  Expected: Message appears in the channel
- [ ] Test message formatting:
  ```bash
  npx ts-node -e "
  import { formatMessage } from './src/publisher';
  const article = {
    id: 1, rawHash: 'abc', title: 'Bybit Hacked for 1.5B',
    url: 'https://cointelegraph.com/news/bybit', sourceName: 'CoinTelegraph',
    sourceType: 'rss', publishedAt: new Date().toISOString(),
    relevanceScore: 9.5, category: 'security',
    summaryRu: 'Биржа Bybit была взломана. Украдено 1.5 млрд долларов.',
    published: false, createdAt: new Date().toISOString()
  };
  console.log(formatMessage(article));
  "
  ```
- [ ] Verify emoji mapping: test all 5 categories in `formatMessage`
- [ ] Verify `sourceName` cleaning removes `CryptoPanic:` prefix
- [ ] Verify messages over 4096 chars are truncated without crashing
- [ ] Verify `disable_web_page_preview: true` is set (no link previews in channel)

### Phase 7 Commit Message

```
feat: implement Telegram channel publisher with formatted message output

- Add formatMessage() with exact template: emoji, title, Russian summary, source link
- Add category emoji mapping for all 5 categories
- Add publishArticle() with Telegraf sendMessage and error handling
- Add publishArticlesBatch() with 1.5s flood-limit delay
- Add testPublisher() and sendStatusMessage() for health checks
- Handle source name cleanup for CryptoPanic: prefix format
```

---

## Phase 8: Orchestrator + Scheduler

### Goal
Wire all components together in a main loop with cron scheduling, error recovery, and graceful shutdown.

### Files to Create

#### `src/orchestrator/index.ts`

```typescript
import cron from 'node-cron';
import {
  initDatabase,
  insertRawArticlesBatch,
  getUnprocessedArticles,
  updateArticleWithLLMResult,
  getArticlesToPublish,
  markArticleAsPublished,
  cleanupOldArticles,
  getDatabaseStats,
  closeDatabase,
} from '../database/index.js';
import { fetchAllRssFeeds } from '../collectors/rss.js';
import { fetchAllApiSources } from '../collectors/api.js';
import {
  initTelegramClient,
  fetchAllTelegramChannels,
  disconnectTelegramClient,
} from '../collectors/telegram.js';
import { filterArticleWithLLM } from '../llm/filter.js';
import { initPublisher, publishArticle, sendStatusMessage } from '../publisher/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { LLMFilterRequest } from '../types/index.js';

// ============================================================
// ORCHESTRATOR STATE
// ============================================================

let isRssRunning = false;
let isApiRunning = false;
let isTelegramRunning = false;
let isLlmRunning = false;
let isPublishRunning = false;

// ============================================================
// COLLECTION PIPELINE
// ============================================================

/**
 * Collects from RSS feeds and inserts new articles into DB.
 * Uses a mutex flag to prevent concurrent runs.
 */
async function runRssCollection(): Promise<void> {
  if (isRssRunning) {
    logger.warn('RSS collection already in progress, skipping');
    return;
  }
  isRssRunning = true;
  try {
    logger.info('--- Starting RSS collection ---');
    const articles = await fetchAllRssFeeds();
    const newCount = insertRawArticlesBatch(articles);
    logger.info(`RSS collection complete: ${newCount} new articles inserted`);
  } catch (error) {
    logger.error(`RSS collection error: ${error}`);
  } finally {
    isRssRunning = false;
  }
}

/**
 * Collects from CryptoPanic and CoinGecko APIs.
 */
async function runApiCollection(): Promise<void> {
  if (isApiRunning) {
    logger.warn('API collection already in progress, skipping');
    return;
  }
  isApiRunning = true;
  try {
    logger.info('--- Starting API collection ---');
    const articles = await fetchAllApiSources();
    const newCount = insertRawArticlesBatch(articles);
    logger.info(`API collection complete: ${newCount} new articles inserted`);
  } catch (error) {
    logger.error(`API collection error: ${error}`);
  } finally {
    isApiRunning = false;
  }
}

/**
 * Collects from Telegram source channels.
 */
async function runTelegramCollection(): Promise<void> {
  if (isTelegramRunning) {
    logger.warn('Telegram collection already in progress, skipping');
    return;
  }
  isTelegramRunning = true;
  try {
    logger.info('--- Starting Telegram collection ---');
    const articles = await fetchAllTelegramChannels();
    const newCount = insertRawArticlesBatch(articles);
    logger.info(`Telegram collection complete: ${newCount} new articles inserted`);
  } catch (error) {
    logger.error(`Telegram collection error: ${error}`);
  } finally {
    isTelegramRunning = false;
  }
}

// ============================================================
// LLM PROCESSING PIPELINE
// ============================================================

/**
 * Processes unprocessed articles through the LLM filter.
 * Fetches up to 30 articles per run to avoid overwhelming the free tier.
 */
async function runLlmProcessing(): Promise<void> {
  if (isLlmRunning) {
    logger.warn('LLM processing already in progress, skipping');
    return;
  }
  isLlmRunning = true;

  try {
    logger.info('--- Starting LLM processing ---');
    const articles = getUnprocessedArticles(30);

    if (articles.length === 0) {
      logger.info('LLM processing: no unprocessed articles');
      return;
    }

    logger.info(`LLM processing: ${articles.length} articles to process`);
    let processedCount = 0;

    for (const article of articles) {
      const request: LLMFilterRequest = {
        title: article.title,
        // content_snippet is stored in DB, use it (it's the first 500 chars of content)
        // The DB column is content_snippet but StoredArticle maps it as summaryRu (null at this point)
        // Actually content_snippet is not in StoredArticle — we use title + sourceName as fallback
        content: article.title, // Will be enriched if we have full content in memory
        sourceName: article.sourceName,
      };

      const result = await filterArticleWithLLM(request);

      if (result) {
        updateArticleWithLLMResult(
          article.id,
          result.relevanceScore,
          result.category,
          result.summaryRu
        );
        processedCount++;
        logger.debug(
          `Article ${article.id} scored: ${result.relevanceScore}/10 [${result.category}]`
        );
      } else {
        // Mark as processed with score 0 to avoid reprocessing failures indefinitely
        updateArticleWithLLMResult(article.id, 0, 'general', 'Не удалось обработать статью.');
        logger.warn(`Article ${article.id} LLM failed, marked with score 0`);
      }

      // Inter-request delay (2 seconds) for free tier
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    logger.info(`LLM processing complete: ${processedCount}/${articles.length} successfully scored`);
  } catch (error) {
    logger.error(`LLM processing error: ${error}`);
  } finally {
    isLlmRunning = false;
  }
}

// ============================================================
// PUBLISH PIPELINE
// ============================================================

/**
 * Publishes articles above the relevance threshold to the Telegram channel.
 */
async function runPublishing(): Promise<void> {
  if (isPublishRunning) {
    logger.warn('Publishing already in progress, skipping');
    return;
  }
  isPublishRunning = true;

  try {
    logger.info('--- Starting publish pipeline ---');
    const articles = getArticlesToPublish(config.relevanceThreshold);

    if (articles.length === 0) {
      logger.info('Publishing: no articles to publish');
      return;
    }

    logger.info(`Publishing: ${articles.length} articles above threshold ${config.relevanceThreshold}`);

    for (const article of articles) {
      const telegramMsgId = await publishArticle(article);

      if (telegramMsgId !== null) {
        markArticleAsPublished(article.id, telegramMsgId);
      }

      // Delay between publishes
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    logger.info(`Publishing complete`);
  } catch (error) {
    logger.error(`Publishing error: ${error}`);
  } finally {
    isPublishRunning = false;
  }
}

// ============================================================
// FULL PIPELINE (collect -> llm -> publish)
// ============================================================

/**
 * Runs a single full pipeline cycle:
 * 1. Collect from all sources
 * 2. Run LLM filter on unprocessed articles
 * 3. Publish scored articles above threshold
 */
async function runFullCycle(): Promise<void> {
  logger.info('========== FULL CYCLE START ==========');
  const cycleStart = Date.now();

  await runRssCollection();
  await runApiCollection();
  await runTelegramCollection();
  await runLlmProcessing();
  await runPublishing();

  const stats = getDatabaseStats();
  const elapsed = Math.round((Date.now() - cycleStart) / 1000);

  logger.info(
    `========== FULL CYCLE END (${elapsed}s) | DB: total=${stats.totalArticles} unprocessed=${stats.unprocessed} published=${stats.published} ==========`
  );
}

// ============================================================
// CRON SCHEDULE SETUP
// ============================================================

/**
 * Sets up all cron jobs.
 *
 * Schedule:
 * - RSS collection: every RSS_INTERVAL_MINUTES (default 15 min)
 * - API collection: every API_INTERVAL_MINUTES (default 10 min)
 * - Telegram collection: every TELEGRAM_INTERVAL_MINUTES (default 5 min)
 * - LLM processing: every 7 minutes (slightly offset from collection)
 * - Publishing: every 5 minutes (after LLM has time to process)
 * - Cleanup: daily at 3:00 AM
 * - Stats log: every 60 minutes
 */
function setupCronJobs(): void {
  const rssInterval = config.intervals.rssMinutes;
  const apiInterval = config.intervals.apiMinutes;
  const tgInterval = config.intervals.telegramMinutes;

  // RSS collection
  cron.schedule(`*/${rssInterval} * * * *`, () => {
    runRssCollection().catch(e => logger.error(`Cron RSS error: ${e}`));
  });

  // API collection
  cron.schedule(`*/${apiInterval} * * * *`, () => {
    runApiCollection().catch(e => logger.error(`Cron API error: ${e}`));
  });

  // Telegram collection
  cron.schedule(`*/${tgInterval} * * * *`, () => {
    runTelegramCollection().catch(e => logger.error(`Cron TG error: ${e}`));
  });

  // LLM processing (every 7 minutes)
  cron.schedule('*/7 * * * *', () => {
    runLlmProcessing().catch(e => logger.error(`Cron LLM error: ${e}`));
  });

  // Publishing (every 5 minutes)
  cron.schedule('*/5 * * * *', () => {
    runPublishing().catch(e => logger.error(`Cron publish error: ${e}`));
  });

  // Daily cleanup at 3:00 AM
  cron.schedule('0 3 * * *', () => {
    const removed = cleanupOldArticles(7);
    logger.info(`Daily cleanup: removed ${removed} old articles`);
  });

  // Hourly stats log
  cron.schedule('0 * * * *', () => {
    const stats = getDatabaseStats();
    logger.info(`HOURLY STATS: ${JSON.stringify(stats)}`);
  });

  logger.info('Cron jobs scheduled');
}

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  try {
    await disconnectTelegramClient();
    closeDatabase();
    logger.info('Graceful shutdown complete');
  } catch (error) {
    logger.error(`Error during shutdown: ${error}`);
  } finally {
    process.exit(0);
  }
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

async function main(): Promise<void> {
  logger.info('=== Crypto News Bot Starting ===');

  // Setup signal handlers
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error}`);
    gracefulShutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
  });

  try {
    // 1. Initialize database
    initDatabase();

    // 2. Initialize Telegram userbot (gramjs)
    await initTelegramClient();

    // 3. Initialize publisher (telegraf bot)
    initPublisher();

    // 4. Setup cron jobs
    setupCronJobs();

    // 5. Run initial full cycle immediately on startup
    logger.info('Running initial collection cycle...');
    await runFullCycle();

    // 6. Send startup notification to channel
    await sendStatusMessage('Бот запущен и работает. Начинаю мониторинг крипто-новостей.');

    logger.info('=== Crypto News Bot Running ===');
    logger.info(`Relevance threshold: ${config.relevanceThreshold}/10`);
    logger.info(`Schedule: RSS every ${config.intervals.rssMinutes}m, API every ${config.intervals.apiMinutes}m, TG every ${config.intervals.telegramMinutes}m`);

  } catch (error) {
    logger.error(`Fatal startup error: ${error}`);
    process.exit(1);
  }
}

main();
```

### Phase 8 Review Checklist

- [ ] Run `npm run typecheck` — zero TypeScript errors
- [ ] Run full cycle in dry-run mode:
  ```bash
  npx ts-node src/orchestrator/index.ts
  ```
- [ ] Verify startup sequence in logs: DB init → TG client → Publisher init → Cron setup → First cycle
- [ ] Verify DB stats logged after first cycle (non-zero totalArticles)
- [ ] Verify articles appear in the Telegram channel after first cycle
- [ ] Verify mutex flags work: manually trigger two concurrent runs and check "already in progress" warnings
- [ ] Verify graceful shutdown on Ctrl+C: TG client disconnects, DB closes cleanly
- [ ] Verify `unhandledRejection` handler logs errors without crashing
- [ ] Check `logs/combined.log` has structured log output
- [ ] Verify cron job timing by waiting 15 minutes and checking for second RSS run

### Phase 8 Commit Message

```
feat: implement main orchestrator with cron scheduling and full pipeline

- Add runRssCollection, runApiCollection, runTelegramCollection with mutex flags
- Add runLlmProcessing with 30-article batch limit and 2s inter-request delay
- Add runPublishing with threshold filtering and markArticleAsPublished
- Add runFullCycle() for complete collect->filter->publish pipeline
- Setup 7 cron jobs: RSS/API/TG collection, LLM processing, publishing, cleanup, stats
- Add graceful shutdown on SIGINT/SIGTERM with client disconnect and DB close
- Add uncaughtException and unhandledRejection handlers
```

---

## Phase 9: Deployment

### Goal
Configure PM2 for production process management, write setup documentation, and finalize the project.

### Files to Create

#### `ecosystem.config.js`

```javascript
module.exports = {
  apps: [
    {
      name: 'crypto-news-bot',
      script: './dist/orchestrator/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '30s',
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
    },
  ],
};
```

#### `README.md`

```markdown
# Crypto News Bot

A Telegram bot that aggregates crypto news from RSS feeds, Telegram channels, and APIs, filters them through Qwen LLM, and publishes important news in Russian.

## Prerequisites

- Node.js 20+
- npm 9+
- PM2 (`npm install -g pm2`)
- A Telegram account for userbot (gramjs)
- A Telegram bot token (create via @BotFather)
- The bot must be an **admin** in your target channel with "Post Messages" permission

## Setup

### 1. Install dependencies
\`\`\`bash
npm install
\`\`\`

### 2. Configure environment
\`\`\`bash
cp .env.example .env
\`\`\`
Edit `.env` with your values. See `.env.example` for all required fields.

### 3. Get Telegram API credentials
1. Go to https://my.telegram.org
2. Log in and go to "API development tools"
3. Create a new application
4. Copy `api_id` and `api_hash` to `.env`

### 4. Authenticate Telegram userbot (one-time)
\`\`\`bash
npx ts-node src/collectors/telegram.ts
\`\`\`
Follow the prompts. After auth, copy the printed `TELEGRAM_SESSION` value to `.env`.

### 5. Get OpenRouter API key
1. Go to https://openrouter.ai
2. Create a free account
3. Generate an API key
4. Add to `.env` as `OPENROUTER_API_KEY`

### 6. Build the project
\`\`\`bash
npm run build
\`\`\`

### 7. Start with PM2
\`\`\`bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Follow the printed command to enable autostart
\`\`\`

## Monitoring

\`\`\`bash
pm2 status                          # Process status
pm2 logs crypto-news-bot            # Live logs
pm2 logs crypto-news-bot --lines 100  # Last 100 lines
tail -f logs/combined.log           # Application logs
\`\`\`

## Configuration

All settings are in `.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `RELEVANCE_THRESHOLD` | Minimum score (0-10) to publish | `6` |
| `RSS_INTERVAL_MINUTES` | RSS polling interval | `15` |
| `API_INTERVAL_MINUTES` | API polling interval | `10` |
| `TELEGRAM_INTERVAL_MINUTES` | Telegram channel polling interval | `5` |
| `OPENROUTER_MODEL` | Qwen model ID on OpenRouter | `qwen/qwen-2.5-72b-instruct:free` |

## Category Legend

- 🔴 Security — hacks, exploits, vulnerabilities
- 🟡 Platform — exchange/protocol launches and closures
- 🟣 Regulatory — government actions, laws, sanctions
- 🔵 On-chain — whale moves, large transfers, DeFi events
- ⚪ General — important news that doesn't fit other categories

## Stopping

\`\`\`bash
pm2 stop crypto-news-bot
pm2 delete crypto-news-bot
\`\`\`
```

### Production Deployment Commands

```bash
# 1. Build TypeScript
npm run build

# 2. Verify dist/ was created
ls dist/orchestrator/index.js

# 3. Start with PM2
pm2 start ecosystem.config.js

# 4. Check it's running
pm2 status

# 5. Save PM2 process list for autostart
pm2 save

# 6. Setup autostart (run the command that pm2 startup prints)
pm2 startup
```

### Phase 9 Review Checklist

- [ ] `npm run build` completes without errors
- [ ] `dist/` directory contains compiled JS files
- [ ] `pm2 start ecosystem.config.js` starts the process (status: `online`)
- [ ] `pm2 logs crypto-news-bot` shows normal log output (no crash loops)
- [ ] Verify `logs/pm2-out.log` and `logs/pm2-error.log` are being written
- [ ] Wait 15 minutes and verify a cron cycle ran (check `logs/combined.log`)
- [ ] Verify bot is posting to the channel after LLM filtering
- [ ] Test crash recovery: `kill -9 $(pm2 pid crypto-news-bot)` — PM2 should restart it within 5 seconds
- [ ] Verify `max_restarts: 10` and `min_uptime: 30s` are working (check `pm2 show crypto-news-bot`)
- [ ] `pm2 save` completed (check `~/.pm2/dump.pm2` exists)

### Phase 9 Commit Message

```
feat: add PM2 deployment config and comprehensive README

- Add ecosystem.config.js with 500MB memory limit and crash recovery
- Configure PM2 log rotation to logs/pm2-*.log files
- Write full README with setup steps, monitoring commands, category legend
- Document all env variables with defaults in README table
- Add production build and deployment command sequence
```

---

## Final Project Dependency Reference

### Complete `package.json` dependencies block

```json
{
  "dependencies": {
    "axios": "^1.6.7",
    "better-sqlite3": "^9.4.3",
    "dotenv": "^16.4.4",
    "input": "^1.0.1",
    "node-cron": "^3.0.3",
    "rss-parser": "^3.13.0",
    "telegraf": "^4.16.3",
    "telegram": "^2.19.7",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/node": "^20.11.16",
    "@types/node-cron": "^3.0.11",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
```

---

## Critical Implementation Notes for Qwen

1. **gramjs StringSession** — On first run, `initTelegramClient()` will prompt interactively. The developer must run this manually from the terminal once, copy the printed session string to `.env`, then the bot can run headlessly. Do not skip this step.

2. **LLM Content Source** — The `StoredArticle` returned by `getUnprocessedArticles()` does not include the full article content (only the 500-char snippet stored in `content_snippet` column). In `runLlmProcessing()`, the title is used as a fallback. For richer LLM context, the orchestrator should ideally process articles immediately after insertion (before the full content is lost from memory). This can be improved by adding a `content_snippet` field to `StoredArticle` (map from `content_snippet` DB column in `mapRowToStoredArticle`).

3. **OpenRouter Free Tier Limits** — The Qwen free model has rate limits (typically 20 requests/minute). The 2-second inter-request delay in `runLlmProcessing()` and the 30-article batch limit should keep usage within limits. If rate limit errors appear (HTTP 429), increase `INTER_REQUEST_DELAY_MS` to 4000.

4. **Telegram Flood Limits** — Both the userbot (gramjs) and the publishing bot (telegraf) are subject to flood limits. The 1-second delay in `fetchAllTelegramChannels()` and 1.5-second delay in `publishArticlesBatch()` are conservative minimums. If flood errors occur, increase these delays.

5. **SQLite WAL Mode** — WAL journal mode is set in `initDatabase()`. This allows concurrent reads while a write is in progress, which is important because cron jobs may attempt to read while another job is writing.

6. **Fix StoredArticle for content_snippet** — Add `contentSnippet: string` to the `StoredArticle` interface in `src/types/index.ts` and update `mapRowToStoredArticle` to map `row['content_snippet']`. Then use `article.contentSnippet` in `runLlmProcessing()` instead of `article.title`.

---

### Critical Files for Implementation

- `/src/types/index.ts` — All shared TypeScript interfaces that every other module depends on; must be implemented first and exactly as specified
- `/src/database/index.ts` — SQLite schema, all CRUD functions, and deduplication logic; the central persistence layer
- `/src/llm/filter.ts` — Qwen LLM integration with exact prompt template, JSON validation, and rate limiting
- `/src/orchestrator/index.ts` — Main entry point wiring all phases together with cron scheduling and graceful shutdown
- `/src/collectors/telegram.ts` — gramjs userbot authentication and channel reading; requires manual one-time setup before headless operation