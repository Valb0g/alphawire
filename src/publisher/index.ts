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
function cleanUrl(url: string): string {
  try {
    const u = new URL(url)
    u.searchParams.delete('utm_source')
    u.searchParams.delete('utm_medium')
    u.searchParams.delete('utm_campaign')
    u.searchParams.delete('utm_content')
    u.searchParams.delete('utm_term')
    return u.toString()
  } catch {
    return url
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Removes CJK (Chinese/Japanese/Korean) characters from a string. */
function stripCJK(text: string): string {
  // CJK Unified Ideographs, CJK Extension A/B, CJK Compatibility, Hiragana, Katakana, etc.
  return text.replace(/[\u2E80-\u2EFF\u3000-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\u{20000}-\u{2A6DF}]/gu, '').trim()
}

/** Strips social-media noise: hashtags (#Binance → Binance) and @-mentions. */
function stripSocialNoise(text: string): string {
  return text.replace(/#(\w+)/g, '$1').replace(/@\w+/g, '').replace(/\s{2,}/g, ' ').trim()
}

/** Truncates at the last word boundary at or before maxLen chars. */
function truncateAtWord(text: string, maxLen = 120): string {
  if (text.length <= maxLen) return text
  const cut = text.lastIndexOf(' ', maxLen)
  return (cut > 0 ? text.slice(0, cut) : text.slice(0, maxLen)) + '…'
}

/** Sanitizes a title: strip CJK, hashtags, truncate cleanly. */
function sanitizeTitle(raw: string): string {
  return truncateAtWord(stripSocialNoise(stripCJK(raw)))
}

export function formatMessage(article: StoredArticle): string {
  const emoji = CATEGORY_EMOJI[article.category ?? 'general']
  // Prefer LLM-translated title (no CJK), fall back to original; always sanitize
  const rawTitle = (article.titleRu && article.titleRu.length > 5)
    ? article.titleRu
    : article.title
  const title = escapeHtml(sanitizeTitle(rawTitle))
  const sourceName = article.sourceName.split(':').pop() ?? article.sourceName
  const url = cleanUrl(article.url)

  if (article.editorialSummaryRu && article.discussionQuestion) {
    const summary = escapeHtml(article.editorialSummaryRu.trim())
    const question = escapeHtml(article.discussionQuestion.trim())
    
    let message = `🚨${emoji} ${title}\n\n${summary}\n\n💬 ${question}\n\n🔗 <a href="${url}">${escapeHtml(sourceName)}</a>`
    if (message.length > TELEGRAM_MAX_LENGTH) {
      const truncatedSummary = escapeHtml(article.editorialSummaryRu.trim().substring(0, TELEGRAM_MAX_LENGTH - 300) + '...')
      message = `🚨${emoji} ${title}\n\n${truncatedSummary}\n\n💬 ${question}\n\n🔗 <a href="${url}">${escapeHtml(sourceName)}</a>`
    }
    return message
  }

  const summary = escapeHtml((article.summaryRu ?? 'Краткое содержание недоступно.').trim())
  const message = `${emoji} ${title}\n\n${summary}\n\n🔗 <a href="${url}">${escapeHtml(sourceName)}</a>`

  if (message.length > TELEGRAM_MAX_LENGTH) {
    const truncatedSummary = escapeHtml(summary.substring(0, TELEGRAM_MAX_LENGTH - 200) + '...')
    return `${emoji} ${title}\n\n${truncatedSummary}\n\n🔗 <a href="${url}">${escapeHtml(sourceName)}</a>`
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
    const replyMarkup = (article.editorialSummaryRu && config.telegram.discussionGroupUrl)
      ? { inline_keyboard: [[{ text: '💬 Обсудить', url: config.telegram.discussionGroupUrl }]] }
      : undefined

    const sentMessage = await bot.telegram.sendMessage(
      config.telegram.channelId,
      messageText,
      {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: replyMarkup
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

