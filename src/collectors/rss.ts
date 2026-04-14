import Parser from 'rss-parser'
import { RawArticle, RssFeedConfig } from '../types/index'
import { generateArticleHash } from '../utils/hash'
import { logger } from '../utils/logger'

// Type augmentation for rss-parser to handle custom fields
type CustomFeed = Record<string, unknown>
type CustomItem = {
  title?: string
  link?: string
  content?: string
  contentSnippet?: string
  summary?: string
  description?: string
  pubDate?: string
  isoDate?: string
  'content:encoded'?: string
  'dc:creator'?: string
}

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
]

const parser = new Parser<CustomFeed, CustomItem>({
  customFields: {
    item: [
      ['content:encoded', 'content:encoded'],
      ['dc:creator', 'dc:creator'],
    ],
  },
  timeout: 10000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; AlphaWire/1.0)',
    'Accept': 'application/rss+xml, application/xml, text/xml',
  },
})

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
    ''
  // Strip HTML tags
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 2000)
}

/**
 * Parses a date string from an RSS item into a Date object.
 * Falls back to current time if parsing fails.
 */
function parseDate(item: CustomItem): Date {
  const dateStr = item.isoDate ?? item.pubDate
  if (!dateStr) return new Date()
  const parsed = new Date(dateStr)
  return isNaN(parsed.getTime()) ? new Date() : parsed
}

/**
 * Fetches and normalizes a single RSS feed.
 * Returns an empty array on error (logs the error).
 */
export async function fetchRssFeed(feedConfig: RssFeedConfig): Promise<RawArticle[]> {
  try {
    logger.debug(`Fetching RSS feed: ${feedConfig.url}`)
    const feed = await parser.parseURL(feedConfig.url)
    const articles: RawArticle[] = []

    for (const item of feed.items) {
      const title = item.title?.trim()
      const url = item.link?.trim()

      if (!title || !url) {
        logger.debug(`Skipping RSS item missing title or URL from ${feedConfig.sourceName}`)
        continue
      }

      const content = extractContent(item)
      const publishedAt = parseDate(item)
      const rawHash = generateArticleHash(title, url)

      articles.push({
        title,
        url,
        content,
        publishedAt,
        sourceName: feedConfig.sourceName,
        sourceType: 'rss',
        rawHash,
      })
    }

    logger.info(`RSS [${feedConfig.sourceName}]: fetched ${articles.length} articles`)
    return articles
  } catch (error) {
    logger.error(`RSS fetch failed for ${feedConfig.sourceName} (${feedConfig.url}): ${error}`)
    return []
  }
}

/**
 * Fetches all configured RSS feeds concurrently with a concurrency limit of 3.
 * Returns all normalized RawArticle objects from all feeds combined.
 */
export async function fetchAllRssFeeds(): Promise<RawArticle[]> {
  const CONCURRENCY = 3
  const allArticles: RawArticle[] = []

  // Process in batches to respect concurrency limit
  for (let i = 0; i < RSS_FEEDS.length; i += CONCURRENCY) {
    const batch = RSS_FEEDS.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(batch.map(feedConfig => fetchRssFeed(feedConfig)))

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allArticles.push(...result.value)
      }
      // Errors are already logged inside fetchRssFeed
    }
  }

  logger.info(`RSS collector total: ${allArticles.length} articles from ${RSS_FEEDS.length} feeds`)
  return allArticles
}
