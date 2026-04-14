import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import input from 'input'
import { RawArticle, TelegramSourceChannel } from '../types/index'
import { generateArticleHash } from '../utils/hash'
import { config } from '../config/index'
import { logger } from '../utils/logger'

const SOURCE_CHANNELS: TelegramSourceChannel[] = [
  { username: 'zachxbt', sourceName: 'ZachXBT' },
  { username: 'peckshieldalert', sourceName: 'PeckShield' },
  { username: 'blocksecteam', sourceName: 'BlockSec' },
  { username: 'whale_alert', sourceName: 'WhaleAlert' },
  { username: 'lookonchain', sourceName: 'LookOnChain' },
]

// Minimum message length to consider as a news item (filter out short reactions/reposts)
const MIN_MESSAGE_LENGTH = 50

// How many recent messages to fetch per channel per cycle
const MESSAGES_PER_CHANNEL = 20

let telegramClient: TelegramClient | null = null

/**
 * Initializes the gramjs TelegramClient with StringSession.
 * On first run (empty session), performs interactive phone authentication.
 * On subsequent runs, restores session from config.
 */
export async function initTelegramClient(): Promise<void> {
  if (telegramClient?.connected) {
    return
  }

  const session = new StringSession(config.telegram.session)

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
  )

  await telegramClient.start({
    phoneNumber: async () => config.telegram.phone,
    password: async () => await input.text('Enter 2FA password (if enabled): '),
    phoneCode: async () => await input.text('Enter the verification code sent to your phone: '),
    onError: (err: Error) => {
      logger.error(`Telegram auth error: ${err.message}`)
    },
  })

  // Save the session string for future use
  const sessionString = (session as StringSession).save()
  if (sessionString !== config.telegram.session) {
    logger.warn(`New Telegram session generated. Add to .env:\nTELEGRAM_SESSION=${sessionString}`)
    console.log(`\n\nSAVE THIS TO .env: TELEGRAM_SESSION=${sessionString}\n\n`)
  }

  logger.info('Telegram userbot client connected')
}

/**
 * Fetches recent messages from a single Telegram channel.
 * Returns normalized RawArticle objects.
 */
async function fetchChannelMessages(channel: TelegramSourceChannel): Promise<RawArticle[]> {
  if (!telegramClient?.connected) {
    throw new Error('Telegram client not initialized')
  }

  try {
    const messages = await telegramClient.getMessages(channel.username, {
      limit: MESSAGES_PER_CHANNEL,
    })

    const articles: RawArticle[] = []

    for (const message of messages) {
      // Skip service messages, empty messages, and short messages
      if (!message.message || message.message.length < MIN_MESSAGE_LENGTH) {
        continue
      }

      const text = message.message.trim()
      const messageDate = new Date((message.date ?? 0) * 1000)
      const messageId = message.id

      // Generate a pseudo-URL for deduplication (Telegram messages don't have real URLs)
      const pseudoUrl = `https://t.me/${channel.username}/${messageId}`

      // Use first line or first 100 chars as title
      const firstLine = text.split('\n')[0] ?? ''
      const title = firstLine.length > 10
        ? firstLine.substring(0, 120)
        : text.substring(0, 120)

      const rawHash = generateArticleHash(title, pseudoUrl)

      articles.push({
        title,
        url: pseudoUrl,
        content: text.substring(0, 2000),
        publishedAt: messageDate,
        sourceName: channel.sourceName,
        sourceType: 'telegram',
        rawHash,
      })
    }

    logger.debug(`Telegram [${channel.sourceName}]: fetched ${articles.length} messages`)
    return articles
  } catch (error) {
    logger.error(`Failed to fetch from Telegram channel ${channel.username}: ${error}`)
    return []
  }
}

/**
 * Fetches messages from all configured source channels sequentially.
 * Sequential (not concurrent) to avoid Telegram flood limits.
 * Adds a 1-second delay between channels.
 */
export async function fetchAllTelegramChannels(): Promise<RawArticle[]> {
  if (!telegramClient?.connected) {
    logger.warn('Telegram client not connected, skipping channel fetch')
    return []
  }

  const allArticles: RawArticle[] = []

  for (const channel of SOURCE_CHANNELS) {
    const articles = await fetchChannelMessages(channel)
    allArticles.push(...articles)

    // Delay to avoid Telegram flood limits
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  logger.info(`Telegram collector total: ${allArticles.length} messages from ${SOURCE_CHANNELS.length} channels`)
  return allArticles
}

/**
 * Disconnects the Telegram client gracefully.
 */
export async function disconnectTelegramClient(): Promise<void> {
  if (telegramClient?.connected) {
    await telegramClient.disconnect()
    telegramClient = null
    logger.info('Telegram userbot client disconnected')
  }
}
