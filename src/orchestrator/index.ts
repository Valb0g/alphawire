import cron from 'node-cron'
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
} from '../database/index.js'
import { fetchAllRssFeeds } from '../collectors/rss.js'
import { fetchAllApiSources } from '../collectors/api.js'
import {
  initTelegramClient,
  fetchAllTelegramChannels,
  disconnectTelegramClient,
} from '../collectors/telegram.js'
import { filterArticleWithLLM } from '../llm/filter.js'
import { initPublisher, publishArticle, sendStatusMessage } from '../publisher/index.js'
import { startHealthServer } from '../health.js'
import { config } from '../config/index.js'
import { logger } from '../utils/logger.js'
import { LLMFilterRequest } from '../types/index.js'

// ============================================================
// ORCHESTRATOR STATE
// ============================================================

let isCycleRunning = false

// ============================================================
// FULL PIPELINE (collect -> llm -> publish)
// ============================================================

/**
 * Single unified cycle every 10 minutes:
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
          updateArticleWithLLMResult(article.id, result.relevanceScore, result.category, result.summaryRu)
          logger.debug(`[${result.relevanceScore}/10] ${article.title.slice(0, 60)}`)
        } else {
          updateArticleWithLLMResult(article.id, 0, 'general', '')
        }

        // 2s delay between LLM requests (free tier rate limit)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }

    // Step 3: Publish articles above threshold
    const toPublish = getArticlesToPublish(config.relevanceThreshold)

    if (toPublish.length === 0) {
      logger.info('Nothing to publish this cycle')
    } else {
      logger.info(`Publishing ${toPublish.length} articles...`)

      for (const article of toPublish) {
        const msgId = await publishArticle(article)
        if (msgId !== null) {
          markArticleAsPublished(article.id, msgId)
        }
        await new Promise(resolve => setTimeout(resolve, 1500))
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
  // Main cycle: every 10 minutes
  cron.schedule('*/10 * * * *', () => {
    runFullCycle().catch(e => logger.error(`Cron cycle error: ${e}`))
  })

  // Daily cleanup at 3:00 AM — remove articles older than 7 days
  cron.schedule('0 3 * * *', () => {
    const removed = cleanupOldArticles(7)
    logger.info(`Daily cleanup: removed ${removed} old articles`)
  })

  logger.info('Cron scheduled: full cycle every 10 min, cleanup daily at 03:00')
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

  logger.info('=== Crypto News Bot Starting ===')

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

    logger.info('=== Crypto News Bot Running ===')
    logger.info(`Relevance threshold: ${config.relevanceThreshold}/10`)

  } catch (error) {
    logger.error(`Fatal startup error: ${error}`)
    process.exit(1)
  }
}

main()
