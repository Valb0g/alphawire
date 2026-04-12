import crypto from 'crypto'

/**
 * Generates a SHA-256 hash for deduplication.
 * Input is normalized: lowercased, trimmed, whitespace collapsed.
 */
export function generateArticleHash(title: string, url: string): string {
  const normalized = `${title.toLowerCase().trim()}|${url.toLowerCase().trim()}`
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

