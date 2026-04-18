import cron from 'node-cron'
import {
  initDatabase,
  insertRawArticlesBatch,
  getUnprocessedArticles,
  updateArticleWithLLMResult,
  getArticlesToPublish,
  getRecentlyPublishedTitles,
  suppressArticles,
  markArticleAsPublished,
  cleanupOldArticles,
  getDatabaseStats,
  closeDatabase,
  updateArticleWithEditorial,
} from '../database/index'
import { fetchAllRssFeeds } from '../collectors/rss'
import { fetchAllApiSources } from '../collectors/api'
import {
  initTelegramClient,
  fetchAllTelegramChannels,
  disconnectTelegramClient,
} from '../collectors/telegram'
import { filterArticleWithLLM, generateEditorialContent } from '../llm/filter'
import { initPublisher, publishArticle, sendStatusMessage } from '../publisher/index'
import { startHealthServer } from '../health'
import { config } from '../config/index'
import { logger } from '../utils/logger'
import { LLMFilterRequest } from '../types/index'

// ============================================================
// SEMANTIC DUPLICATE DETECTION
// ============================================================

// Common English words that don't help identify a unique story
const DEDUP_STOP_WORDS = new Set([
  'from', 'with', 'that', 'this', 'have', 'been', 'will', 'about', 'into',
  'over', 'after', 'before', 'their', 'which', 'would', 'could', 'should',
  'amid', 'active', 'says', 'says', 'attack', 'platform', 'users', 'funds',
  'stolen', 'loss', 'more', 'than', 'also', 'just', 'first', 'last', 'new',
  'what', 'when', 'where', 'they', 'were', 'bitcoin', 'ethereum', 'crypto',
  'token', 'coins', 'market',
])

/**
 * Extracts significant terms from a title for duplicate detection.
 * Keeps project names, amounts, specific nouns.
 */
function extractKeyTerms(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[\s\W]+/)
      .filter(w => w.length > 3 && !DEDUP_STOP_WORDS.has(w))
  )
}

/**
 * Returns true if two titles likely cover the same story.
 * Threshold: 2+ shared significant terms.
 */
function titlesOverlap(t1: string, t2: string, minShared = 2): boolean {
  const terms1 = extractKeyTerms(t1)
  const terms2 = extractKeyTerms(t2)
  let count = 0
  for (const term of terms1) {
    if (terms2.has(term) && ++count >= minShared) return true
  }
  return false
}

// ============================================================
// ORCHESTRATOR STATE
// ============================================================

let isCycleRunning = false
let lastPublishedAt: Date | null = null

// Minimum interval between posts (ms) — 3 hours default
const MIN_PUBLISH_INTERVAL_MS = parseInt(
  process.env.MIN_PUBLISH_INTERVAL_MINUTES ?? '180'
) * 60 * 1000

// Quiet hours in Moscow time (UTC+3) — no publishing during these hours.
// Collection and LLM filtering continue; only publish step is skipped.
const QUIET_HOURS_START = parseInt(process.env.QUIET_HOURS_START ?? '23', 10)
const QUIET_HOURS_END = parseInt(process.env.QUIET_HOURS_END ?? '7', 10)
const QUIET_HOURS_TZ_OFFSET = parseInt(process.env.QUIET_HOURS_TZ_OFFSET ?? '3', 10)

function isQuietHours(): boolean {
  const hour = (new Date().getUTCHours() + QUIET_HOURS_TZ_OFFSET + 24) % 24
  // Start > end means wraparound midnight (e.g. 23..7)
  if (QUIET_HOURS_START > QUIET_HOURS_END) {
    return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END
  }
  return hour >= QUIET_HOURS_START && hour < QUIET_HOURS_END
}

// ============================================================
// FULL PIPELINE (collect -> llm -> publish)
// ============================================================

/**
 * Single unified cycle every 20 minutes:
 * 1. Collect from ALL sources (RSS + API + Telegram) in parallel
 * 2. Run LLM filter on new unprocessed articles
 * 3. If anything scored above threshold → publish
 * 4. If nothing → log "nothing to publish" and wait for next cycle
 */
async function runFullCycle(): Promise<void> {
  if (isCycleRunning) {
    logger.warn('Cycle already in progress, skipping')
    return
  }
  isCycleRunning = true

  logger.info('========== CYCLE START ==========')
  const cycleStart = Date.now()

  try {
    // Step 1: Collect from all sources in parallel
    logger.info('Collecting from all sources...')
    const [rssArticles, apiArticles, tgArticles] = await Promise.allSettled([
      fetchAllRssFeeds(),
      fetchAllApiSources(),
      fetchAllTelegramChannels(),
    ])

    let totalNew = 0

    if (rssArticles.status === 'fulfilled') {
      totalNew += insertRawArticlesBatch(rssArticles.value)
    } else {
      logger.error(`RSS failed: ${rssArticles.reason}`)
    }

    if (apiArticles.status === 'fulfilled') {
      totalNew += insertRawArticlesBatch(apiArticles.value)
    } else {
      logger.error(`API failed: ${apiArticles.reason}`)
    }

    if (tgArticles.status === 'fulfilled') {
      totalNew += insertRawArticlesBatch(tgArticles.value)
    } else {
      logger.error(`Telegram failed: ${tgArticles.reason}`)
    }

    logger.info(`Collection done: ${totalNew} new articles`)

    // Step 2: LLM filter — process up to 30 unprocessed articles
    const unprocessed = getUnprocessedArticles(30)

    if (unprocessed.length === 0) {
      logger.info('No new articles to filter')
    } else {
      logger.info(`Filtering ${unprocessed.length} articles through LLM...`)

      for (const article of unprocessed) {
        const request: LLMFilterRequest = {
          title: article.title,
          content: article.contentSnippet || article.title,
          sourceName: article.sourceName,
        }

        const result = await filterArticleWithLLM(request)

        if (result) {
          updateArticleWithLLMResult(article.id, result.relevanceScore, result.category, result.summaryRu, result.titleRu)
          logger.debug(`[${result.relevanceScore}/10] ${article.title.slice(0, 60)}`)

          if (result.relevanceScore >= config.alphaScoreThreshold) {
            logger.info(`Alpha score detected (${result.relevanceScore} >= ${config.alphaScoreThreshold}). Generating editorial content...`)
            const editorial = await generateEditorialContent(request)
            if (editorial) {
              updateArticleWithEditorial(article.id, editorial.editorialSummaryRu, editorial.discussionQuestion)
              logger.debug(`Editorial content generated for: ${article.title.slice(0, 60)}`)
            }
          }
        } else {
          updateArticleWithLLMResult(article.id, 0, 'general', '', '')
        }

        // 8s delay between LLM requests (free tier rate limit)
        await new Promise(resolve => setTimeout(resolve, 8000))
      }
    }

    // Step 3: Publish — enforce minimum interval and quiet hours
    const now = new Date()
    const timeSinceLast = lastPublishedAt
      ? now.getTime() - lastPublishedAt.getTime()
      : Infinity

    if (isQuietHours()) {
      logger.info(`Skipping publish — quiet hours (${QUIET_HOURS_START}:00–${QUIET_HOURS_END}:00 MSK)`)
    } else if (timeSinceLast < MIN_PUBLISH_INTERVAL_MS) {
      const waitMin = Math.round((MIN_PUBLISH_INTERVAL_MS - timeSinceLast) / 60000)
      logger.info(`Skipping publish — next post in ${waitMin} min`)
    } else {
      const candidates = getArticlesToPublish(config.relevanceThreshold)

      if (candidates.length === 0) {
        logger.info('Nothing to publish this cycle')
      } else {
        // Semantic dedup: get titles published in last 6 hours
        const recentTitles = getRecentlyPublishedTitles(6)

        // Find the best candidate that isn't a duplicate of a recent story
        let articleToPublish = null
        const suppressIds: number[] = []

        for (const candidate of candidates) {
          const isDupeOfRecent = recentTitles.some(t => titlesOverlap(candidate.title, t))
          if (isDupeOfRecent) {
            suppressIds.push(candidate.id)
          } else if (!articleToPublish) {
            articleToPublish = candidate
          }
        }

        // Also suppress candidates that overlap with the article we're about to publish
        if (articleToPublish) {
          for (const c of candidates) {
            if (c.id !== articleToPublish.id &&
                !suppressIds.includes(c.id) &&
                titlesOverlap(c.title, articleToPublish.title)) {
              suppressIds.push(c.id)
            }
          }
        }

        if (suppressIds.length > 0) {
          suppressArticles(suppressIds)
          logger.info(`Suppressed ${suppressIds.length} duplicate articles`)
        }

        if (!articleToPublish) {
          logger.info('All candidates are duplicates of recently published stories')
        } else {
          const msgId = await publishArticle(articleToPublish)
          if (msgId !== null) {
            markArticleAsPublished(articleToPublish.id, msgId)
            lastPublishedAt = new Date()
            logger.info(`Published 1 article. Next post in ${MIN_PUBLISH_INTERVAL_MS / 60000} min`)
          }
        }
      }
    }

  } catch (error) {
    logger.error(`Cycle error: ${error}`)
  } finally {
    isCycleRunning = false
    const elapsed = Math.round((Date.now() - cycleStart) / 1000)
    const stats = getDatabaseStats()
    logger.info(
      `========== CYCLE END (${elapsed}s) | total=${stats.totalArticles} published=${stats.published} ==========`
    )
  }
}

// ============================================================
// CRON SCHEDULE SETUP
// ============================================================

/**
 * Single cron: full cycle every 10 minutes.
 * Daily cleanup at 3:00 AM.
 */
function setupCronJobs(): void {
  // Main cycle: every 20 minutes
  cron.schedule('*/20 * * * *', () => {
    runFullCycle().catch(e => logger.error(`Cron cycle error: ${e}`))
  })

  // Daily cleanup at 3:00 AM — remove articles older than 7 days
  cron.schedule('0 3 * * *', () => {
    const removed = cleanupOldArticles(7)
    logger.info(`Daily cleanup: removed ${removed} old articles`)
  })

  logger.info('Cron scheduled: full cycle every 20 min, cleanup daily at 03:00')
}

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully...`)

  try {
    await disconnectTelegramClient()
    closeDatabase()
    logger.info('Graceful shutdown complete')
  } catch (error) {
    logger.error(`Error during shutdown: ${error}`)
  } finally {
    process.exit(0)
  }
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

async function main(): Promise<void> {
  // Start health server first (for Render.com keep-alive)
  startHealthServer(Number(process.env.PORT) || 3000)

  logger.info('=== AlphaWire Starting ===')

  // Setup signal handlers
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error}`)
    gracefulShutdown('uncaughtException')
  })
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason}`)
  })

  try {
    // 1. Initialize database
    initDatabase()

    // 2. Initialize Telegram userbot (gramjs)
    await initTelegramClient()

    // 3. Initialize publisher (telegraf bot)
    initPublisher()

    // 4. Setup cron jobs
    setupCronJobs()

    // 5. Run initial full cycle immediately on startup
    logger.info('Running initial collection cycle...')
    await runFullCycle()

    // 6. Send startup notification only in production (avoid spam on Render restarts)
    if (process.env.NODE_ENV === 'production') {
      await sendStatusMessage('Бот запущен и работает. Начинаю мониторинг крипто-новостей.')
    }

    logger.info('=== AlphaWire Running ===')
    logger.info(`Relevance threshold: ${config.relevanceThreshold}/10`)

  } catch (error) {
    logger.error(`Fatal startup error: ${error}`)
    process.exit(1)
  }
}

main()
