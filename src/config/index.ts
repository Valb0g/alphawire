import dotenv from 'dotenv'
import { AppConfig } from '../types/index'

dotenv.config()

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue
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
    model: optionalEnv('OPENROUTER_MODEL', 'google/gemma-4-31b-it:free'),
  },
  cryptoPanic: {
    token: optionalEnv('CRYPTOPANIC_TOKEN', ''),
  },
  database: {
    path: optionalEnv('DB_PATH', './data/news.db'),
  },
  relevanceThreshold: parseFloat(optionalEnv('RELEVANCE_THRESHOLD', '6')),
  intervals: {
    rssMinutes: parseInt(optionalEnv('RSS_INTERVAL_MINUTES', '10'), 10),
    apiMinutes: parseInt(optionalEnv('API_INTERVAL_MINUTES', '10'), 10),
    telegramMinutes: parseInt(optionalEnv('TELEGRAM_INTERVAL_MINUTES', '10'), 10),
  },
}
