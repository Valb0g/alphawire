import { Telegraf } from 'telegraf'
import { StoredArticle, NewsCategory } from '../types/index'
import { config } from '../config/index'
import { logger } from '../utils/logger'

const CATEGORY_EMOJI: Record<NewsCategory, string> = {
  security: '🔴',
  platform: '🟡',
  regulatory: '🟣',
  onchain: '🔵',
  general: '⚪',
}

// Telegram message length limit is 4096 characters
const TELEGRAM_MAX_LENGTH = 4096

// Delay between consecutive publish operations (ms) to avoid flood limits
const PUBLISH_DELAY_MS = 1500

let bot: Telegraf | null = null

/**
 * Initializes the Telegraf bot instance.
 * Must be called before any publish operations.
 */
export function initPublisher(): void {
  bot = new Telegraf(config.telegram.botToken)
  logger.info('Telegram publisher (Telegraf) initialized')
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
  const emoji = CATEGORY_EMOJI[article.category ?? 'general']
  const title = article.title.trim()
  const summary = (article.summaryRu ?? 'Краткое содержание недоступно.').trim()
  const sourceName = article.sourceName.split(':').pop() ?? article.sourceName
  const url = article.url

  const message = `${emoji} ${title}\n\n${summary}\n\n🔗 ${sourceName} | ${url}`

  // Truncate if over limit (rare but safe)
  if (message.length > TELEGRAM_MAX_LENGTH) {
    const truncatedSummary = summary.substring(0, TELEGRAM_MAX_LENGTH - 200) + '...'
    return `${emoji} ${title}\n\n${truncatedSummary}\n\n🔗 ${sourceName} | ${url}`
  }

  return message
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
    throw new Error('Publisher not initialized. Call initPublisher() first.')
  }

  if (!article.summaryRu || !article.category) {
    logger.warn(`Skipping article ${article.id} — missing summaryRu or category`)
    return null
  }

  const messageText = formatMessage(article)

  try {
    const sentMessage = await bot.telegram.sendMessage(
      config.telegram.channelId,
      messageText,
      {
        link_preview_options: { is_disabled: true },
      }
    )

    logger.info(
      `Published article ${article.id} to channel. Telegram msg ID: ${sentMessage.message_id}. Title: ${article.title.substring(0, 50)}`
    )

    return sentMessage.message_id
  } catch (error) {
    logger.error(`Failed to publish article ${article.id}: ${error}`)
    return null
  }
}

/**
 * Sends a status/health message to the channel (for monitoring).
 * Used by the orchestrator for startup notifications.
 */
export async function sendStatusMessage(text: string): Promise<void> {
  if (!bot) return
  try {
    await bot.telegram.sendMessage(config.telegram.channelId, `ℹ️ ${text}`, {
      link_preview_options: { is_disabled: true },
    })
  } catch (error) {
    logger.error(`Failed to send status message: ${error}`)
  }
}

