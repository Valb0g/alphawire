import axios, { AxiosResponse } from 'axios'
import { RawArticle, CryptoPanicPost, CoinGeckoNewsItem } from '../types/index'
import { generateArticleHash } from '../utils/hash'
import { config } from '../config/index'
import { logger } from '../utils/logger'

const CRYPTOPANIC_BASE = 'https://cryptopanic.com/api/v1/posts/'
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3/news?per_page=50'

const axiosInstance = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'AlphaWire/1.0',
    'Accept': 'application/json',
  },
})

interface CryptoPanicResponse {
  results: CryptoPanicPost[]
  next: string | null
}

interface CoinGeckoNewsResponse {
  data: CoinGeckoNewsItem[]
}

/**
 * Fetches important crypto news from CryptoPanic API.
 * Returns empty array if token is not configured or request fails.
 */
export async function fetchCryptoPanic(): Promise<RawArticle[]> {
  if (!config.cryptoPanic.token) {
    logger.warn('CryptoPanic token not configured, skipping')
    return []
  }

  try {
    const params = new URLSearchParams({
      auth_token: config.cryptoPanic.token,
      public: 'true',
      kind: 'news',
      filter: 'important',
    })

    const response: AxiosResponse<CryptoPanicResponse> = await axiosInstance.get(
      `${CRYPTOPANIC_BASE}?${params.toString()}`
    )

    const posts = response.data?.results ?? []
    const articles: RawArticle[] = []

    for (const post of posts) {
      const title = post.title?.trim()
      const url = post.url?.trim()

      if (!title || !url) continue

      const publishedAt = new Date(post.published_at)
      const content = [
        `Source: ${post.source.title} (${post.source.domain})`,
        `Currencies: ${(post.currencies ?? []).map(c => c.code).join(', ') || 'N/A'}`,
        `Votes — Positive: ${post.votes.positive}, Negative: ${post.votes.negative}, Important: ${post.votes.important}`,
      ].join('\n')

      articles.push({
        title,
        url,
        content,
        publishedAt,
        sourceName: `CryptoPanic:${post.source.title}`,
        sourceType: 'api',
        rawHash: generateArticleHash(title, url),
      })
    }

    logger.info(`CryptoPanic: fetched ${articles.length} articles`)
    return articles
  } catch (error) {
    logger.error(`CryptoPanic fetch failed: ${error}`)
    return []
  }
}

/**
 * Fetches latest crypto news from CoinGecko public API.
 * No API key required for basic access.
 */
export async function fetchCoinGecko(): Promise<RawArticle[]> {
  try {
    const response: AxiosResponse<CoinGeckoNewsResponse> = await axiosInstance.get(COINGECKO_BASE)
    const items = response.data?.data ?? []
    const articles: RawArticle[] = []

    for (const item of items) {
      const title = item.title?.trim()
      const url = item.url?.trim()

      if (!title || !url) continue

      // CoinGecko uses Unix timestamp in seconds
      const publishedAt = new Date(item.updated_at * 1000)
      const content = item.description?.trim() ?? ''

      articles.push({
        title,
        url,
        content,
        publishedAt,
        sourceName: `CoinGecko:${item.news_site}`,
        sourceType: 'api',
        rawHash: generateArticleHash(title, url),
      })
    }

    logger.info(`CoinGecko: fetched ${articles.length} articles`)
    return articles
  } catch (error) {
    logger.error(`CoinGecko fetch failed: ${error}`)
    return []
  }
}

/**
 * Fetches from all API sources concurrently.
 */
export async function fetchAllApiSources(): Promise<RawArticle[]> {
  const [cryptoPanicArticles, coinGeckoArticles] = await Promise.allSettled([
    fetchCryptoPanic(),
    fetchCoinGecko(),
  ])

  const allArticles: RawArticle[] = []

  if (cryptoPanicArticles.status === 'fulfilled') {
    allArticles.push(...cryptoPanicArticles.value)
  }
  if (coinGeckoArticles.status === 'fulfilled') {
    allArticles.push(...coinGeckoArticles.value)
  }

  logger.info(`API collector total: ${allArticles.length} articles`)
  return allArticles
}
