export type NewsCategory =
  | 'security'
  | 'platform'
  | 'regulatory'
  | 'onchain'
  | 'general'

export type CollectorSource = 'rss' | 'api' | 'telegram'

export interface RawArticle {
  title: string
  url: string
  content: string        // Full text or description
  publishedAt: Date
  sourceName: string     // e.g. "CoinTelegraph", "WuBlockchain"
  sourceType: CollectorSource
  rawHash: string        // SHA-256 of (title + url)
}

export interface FilteredArticle {
  rawArticle: RawArticle
  relevanceScore: number // 0-10 from LLM
  category: NewsCategory
  summaryRu: string      // Russian summary from LLM
  categoryEmoji: string  // Derived from category
}

export interface StoredArticle {
  id: number
  rawHash: string
  title: string
  url: string
  sourceName: string
  sourceType: CollectorSource
  publishedAt: string    // ISO string stored in SQLite
  contentSnippet: string // First 500 chars of content
  relevanceScore: number | null
  category: NewsCategory | null
  summaryRu: string | null
  titleRu: string | null // Russian/English translated title from LLM
  published: boolean     // Whether pushed to Telegram channel
  createdAt: string      // ISO string
}

export interface LLMFilterRequest {
  title: string
  content: string
  sourceName: string
}

export interface LLMFilterResponse {
  relevanceScore: number   // 0-10
  category: NewsCategory
  summaryRu: string        // 2-3 sentence Russian summary
  titleRu: string          // Clean Russian or English title (no CJK/non-Latin chars)
  reasoning: string        // LLM's brief reasoning (not published)
}

export interface RssFeedConfig {
  url: string
  sourceName: string
}

export interface TelegramSourceChannel {
  username: string         // e.g. "zachxbt" (without @)
  sourceName: string       // Human-readable name
}

export interface CryptoPanicPost {
  title: string
  url: string
  published_at: string
  source: {
    title: string
    domain: string
  }
  currencies?: Array<{ code: string; title: string }>
  votes: {
    positive: number
    negative: number
    important: number
  }
}

export interface CoinGeckoNewsItem {
  title: string
  description: string
  url: string
  thumb_2x: string
  news_site: string
  updated_at: number // Unix timestamp
}

export interface AppConfig {
  telegram: {
    botToken: string
    channelId: string
    apiId: number
    apiHash: string
    phone: string
    session: string
  }
  openRouter: {
    apiKey: string
    model: string
  }
  cryptoPanic: {
    token: string
  }
  database: {
    path: string
  }
  relevanceThreshold: number
  intervals: {
    rssMinutes: number
    apiMinutes: number
    telegramMinutes: number
  }
}
