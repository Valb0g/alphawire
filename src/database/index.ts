import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { RawArticle, StoredArticle, NewsCategory, CollectorSource } from '../types/index'
import { config } from '../config/index'
import { logger } from '../utils/logger'

// ============================================================
// EXACT SQLITE SCHEMA
// ============================================================
//
// Table: articles
// ┌──────────────────┬─────────────────┬──────────────────────────┐
// │ Column           │ Type            │ Notes                    │
// ├──────────────────┼─────────────────┼──────────────────────────┤
// │ id               │ INTEGER         │ PRIMARY KEY AUTOINCREMENT │
// │ raw_hash         │ TEXT            │ UNIQUE, SHA-256          │
// │ title            │ TEXT            │ NOT NULL                 │
// │ url              │ TEXT            │ NOT NULL                 │
// │ source_name      │ TEXT            │ NOT NULL                 │
// │ source_type      │ TEXT            │ 'rss'|'api'|'telegram'   │
// │ published_at     │ TEXT            │ ISO 8601 string          │
// │ content_snippet  │ TEXT            │ First 500 chars          │
// │ relevance_score  │ REAL            │ NULL until LLM processes │
// │ category         │ TEXT            │ NULL until LLM processes │
// │ summary_ru       │ TEXT            │ NULL until LLM processes │
// │ published        │ INTEGER         │ 0 or 1 (boolean)         │
// │ llm_processed    │ INTEGER         │ 0 or 1 (boolean)         │
// │ created_at       │ TEXT            │ ISO 8601, auto-set       │
// └──────────────────┴─────────────────┴──────────────────────────┘
//
// Table: publish_log
// ┌──────────────────┬─────────────────┬──────────────────────────┐
// │ id               │ INTEGER         │ PRIMARY KEY AUTOINCREMENT │
// │ article_id       │ INTEGER         │ FK -> articles.id        │
// │ telegram_msg_id  │ INTEGER         │ Telegram message ID      │
// │ published_at     │ TEXT            │ ISO 8601 string          │
// └──────────────────┴─────────────────┴──────────────────────────┘

const CREATE_ARTICLES_TABLE = `
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_hash TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('rss', 'api', 'telegram')),
    published_at TEXT NOT NULL,
    content_snippet TEXT NOT NULL DEFAULT '',
    relevance_score REAL,
    category TEXT CHECK(category IN ('security', 'platform', 'regulatory', 'onchain', 'general')),
    summary_ru TEXT,
    title_ru TEXT,
    editorial_summary_ru TEXT,
    discussion_question TEXT,
    suppressed INTEGER NOT NULL DEFAULT 0 CHECK(suppressed IN (0, 1)),
    published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0, 1)),
    llm_processed INTEGER NOT NULL DEFAULT 0 CHECK(llm_processed IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`

const CREATE_PUBLISH_LOG_TABLE = `
  CREATE TABLE IF NOT EXISTS publish_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id INTEGER NOT NULL REFERENCES articles(id),
    telegram_msg_id INTEGER,
    published_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`

const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_articles_raw_hash ON articles(raw_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_llm_processed ON articles(llm_processed)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_relevance_score ON articles(relevance_score)`,
]

let db: Database.Database | null = null

/**
 * Initializes the SQLite database. Creates tables and indexes if they don't exist.
 * Must be called once at application startup before any other DB operations.
 */
export function initDatabase(): void {
  const dbPath = config.database.path
  const dbDir = path.dirname(dbPath)

  // Ensure data directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  db = new Database(dbPath)

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')

  // Create schema
  db.exec(CREATE_ARTICLES_TABLE)
  db.exec(CREATE_PUBLISH_LOG_TABLE)
  for (const indexSql of CREATE_INDEXES) {
    db.exec(indexSql)
  }

  // Migrations: add new columns to existing databases
  const columns = db.prepare(`PRAGMA table_info(articles)`).all() as Array<{ name: string }>
  const columnNames = new Set(columns.map(c => c.name))
  if (!columnNames.has('title_ru')) {
    db.exec(`ALTER TABLE articles ADD COLUMN title_ru TEXT`)
    logger.info('Migration: added title_ru column')
  }
  if (!columnNames.has('editorial_summary_ru')) {
    db.exec(`ALTER TABLE articles ADD COLUMN editorial_summary_ru TEXT`)
    logger.info('Migration: added editorial_summary_ru column')
  }
  if (!columnNames.has('discussion_question')) {
    db.exec(`ALTER TABLE articles ADD COLUMN discussion_question TEXT`)
    logger.info('Migration: added discussion_question column')
  }
  if (!columnNames.has('suppressed')) {
    db.exec(`ALTER TABLE articles ADD COLUMN suppressed INTEGER NOT NULL DEFAULT 0`)
    logger.info('Migration: added suppressed column')
  }

  logger.info(`Database initialized at ${dbPath}`)
}

/**
 * Returns the database instance. Throws if initDatabase() was not called first.
 */
function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

/**
 * Checks if an article with the given hash already exists in the database.
 */
export function articleExists(rawHash: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM articles WHERE raw_hash = ?')
    .get(rawHash)
  return row !== undefined
}

/**
 * Inserts a RawArticle into the database.
 * Silently ignores duplicates (INSERT OR IGNORE).
 * Returns the inserted row's ID, or null if it was a duplicate.
 */
export function insertRawArticle(article: RawArticle): number | null {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO articles
      (raw_hash, title, url, source_name, source_type, published_at, content_snippet)
    VALUES
      (@rawHash, @title, @url, @sourceName, @sourceType, @publishedAt, @contentSnippet)
  `)

  const result = stmt.run({
    rawHash: article.rawHash,
    title: article.title,
    url: article.url,
    sourceName: article.sourceName,
    sourceType: article.sourceType,
    publishedAt: article.publishedAt.toISOString(),
    contentSnippet: article.content.substring(0, 500),
  })

  if (result.changes === 0) {
    logger.debug(`Duplicate article skipped: ${article.rawHash} (${article.title.substring(0, 50)})`)
    return null
  }

  return result.lastInsertRowid as number
}

/**
 * Inserts multiple raw articles in a single transaction.
 * Returns the count of newly inserted (non-duplicate) articles.
 */
export function insertRawArticlesBatch(articles: RawArticle[]): number {
  const database = getDb()
  let insertedCount = 0

  const insertMany = database.transaction((items: RawArticle[]) => {
    for (const article of items) {
      const id = insertRawArticle(article)
      if (id !== null) insertedCount++
    }
  })

  insertMany(articles)
  logger.info(`Batch insert: ${insertedCount} new articles out of ${articles.length} total`)
  return insertedCount
}

/**
 * Fetches articles that have not yet been processed by the LLM.
 * Returns up to `limit` articles ordered by published_at DESC.
 * Default limit is 50 to prevent overwhelming the LLM API.
 */
export function getUnprocessedArticles(limit = 50): StoredArticle[] {
  const rows = getDb()
    .prepare(`
      SELECT
        id, raw_hash, title, url, source_name, source_type,
        published_at, content_snippet, relevance_score, category,
        summary_ru, title_ru, editorial_summary_ru, discussion_question,
        published, created_at
      FROM articles
      WHERE llm_processed = 0
      ORDER BY published_at DESC
      LIMIT ?
    `)
    .all(limit) as Array<Record<string, unknown>>

  return rows.map(mapRowToStoredArticle)
}

/**
 * Updates an article with LLM filter results.
 * Sets llm_processed = 1 after update.
 */
export function updateArticleWithLLMResult(
  id: number,
  score: number,
  category: NewsCategory,
  summaryRu: string,
  titleRu: string = ''
): void {
  getDb()
    .prepare(`
      UPDATE articles
      SET
        relevance_score = @score,
        category = @category,
        summary_ru = @summaryRu,
        title_ru = @titleRu,
        llm_processed = 1
      WHERE id = @id
    `)
    .run({ score, category, summaryRu, titleRu, id })
}

/**
 * Updates an article with editorial content.
 */
export function updateArticleWithEditorial(
  id: number,
  editorialSummaryRu: string,
  discussionQuestion: string
): void {
  getDb()
    .prepare(`
      UPDATE articles
      SET
        editorial_summary_ru = @editorialSummaryRu,
        discussion_question = @discussionQuestion
      WHERE id = @id
    `)
    .run({ editorialSummaryRu, discussionQuestion, id })
}

/**
 * Marks an article as having been published to the Telegram channel.
 * Also inserts a record into the publish_log table.
 */
export function markArticleAsPublished(articleId: number, telegramMessageId: number): void {
  const database = getDb()

  const markPublish = database.transaction(() => {
    database
      .prepare('UPDATE articles SET published = 1 WHERE id = ?')
      .run(articleId)

    database
      .prepare(`
        INSERT INTO publish_log (article_id, telegram_msg_id)
        VALUES (?, ?)
      `)
      .run(articleId, telegramMessageId)
  })

  markPublish()
}

/**
 * Fetches articles that are LLM-processed, above the relevance threshold,
 * and not yet published to the Telegram channel.
 */
/**
 * Returns top-10 publish candidates for the orchestrator to deduplicate.
 * Excludes: already published, suppressed (duplicates), exact title matches of published articles.
 */
export function getArticlesToPublish(threshold: number): StoredArticle[] {
  const rows = getDb()
    .prepare(`
      SELECT
        id, raw_hash, title, url, source_name, source_type,
        published_at, content_snippet, relevance_score, category,
        summary_ru, title_ru, editorial_summary_ru, discussion_question,
        suppressed, published, created_at
      FROM articles
      WHERE
        llm_processed = 1
        AND published = 0
        AND suppressed = 0
        AND relevance_score >= ?
        AND LOWER(SUBSTR(title, 1, 80)) NOT IN (
          SELECT LOWER(SUBSTR(title, 1, 80)) FROM articles WHERE published = 1
        )
      ORDER BY relevance_score DESC, published_at DESC
      LIMIT 10
    `)
    .all(threshold) as Array<Record<string, unknown>>

  return rows.map(mapRowToStoredArticle)
}

/**
 * Returns titles of articles published in the last N hours.
 * Used for semantic duplicate detection in the orchestrator.
 */
export function getRecentlyPublishedTitles(hoursBack = 6): string[] {
  const cutoff = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString()
  const rows = getDb()
    .prepare(`
      SELECT title FROM articles
      WHERE published = 1 AND created_at >= ?
      ORDER BY created_at DESC
    `)
    .all(cutoff) as Array<{ title: string }>
  return rows.map(r => r.title)
}

/**
 * Marks articles as suppressed (duplicate of a published story).
 * Suppressed articles are excluded from future publish candidates.
 */
export function suppressArticles(ids: number[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  getDb()
    .prepare(`UPDATE articles SET suppressed = 1 WHERE id IN (${placeholders})`)
    .run(...ids)
}

/**
 * Removes articles older than `days` days to prevent unlimited DB growth.
 * Only removes articles that have already been published or have low scores.
 */
export function cleanupOldArticles(days = 7): number {
  const database = getDb()
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - days)
  const cutoff = cutoffDate.toISOString()

  const cleanup = database.transaction(() => {
    // Remove truly orphaned publish_log entries (article no longer exists)
    database.prepare(`
      DELETE FROM publish_log
      WHERE article_id NOT IN (SELECT id FROM articles)
    `).run()

    // Remove publish_log entries for articles about to be deleted
    database.prepare(`
      DELETE FROM publish_log
      WHERE article_id IN (
        SELECT id FROM articles
        WHERE created_at < ?
        AND (published = 1 OR (llm_processed = 1 AND relevance_score < 5))
      )
    `).run(cutoff)

    return database.prepare(`
      DELETE FROM articles
      WHERE
        created_at < ?
        AND (published = 1 OR suppressed = 1 OR (llm_processed = 1 AND relevance_score < 5))
    `).run(cutoff).changes
  })

  const removed = cleanup() as number
  logger.info(`Cleanup: removed ${removed} old articles`)
  return removed
}

/**
 * Maps a raw SQLite row to a StoredArticle object.
 */
function mapRowToStoredArticle(row: Record<string, unknown>): StoredArticle {
  return {
    id: row['id'] as number,
    rawHash: row['raw_hash'] as string,
    title: row['title'] as string,
    url: row['url'] as string,
    sourceName: row['source_name'] as string,
    sourceType: row['source_type'] as CollectorSource,
    publishedAt: row['published_at'] as string,
    contentSnippet: (row['content_snippet'] as string) ?? '',
    relevanceScore: row['relevance_score'] as number | null,
    category: row['category'] as NewsCategory | null,
    summaryRu: row['summary_ru'] as string | null,
    titleRu: (row['title_ru'] as string | null) ?? null,
    editorialSummaryRu: (row['editorial_summary_ru'] as string | null) ?? null,
    discussionQuestion: (row['discussion_question'] as string | null) ?? null,
    suppressed: (row['suppressed'] as number) === 1,
    published: (row['published'] as number) === 1,
    createdAt: row['created_at'] as string,
  }
}

/**
 * Closes the database connection gracefully.
 */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
    logger.info('Database connection closed')
  }
}

/**
 * Returns database statistics for monitoring.
 */
export function getDatabaseStats(): {
  totalArticles: number
  unprocessed: number
  published: number
  pendingPublish: number
} {
  const database = getDb()
  return {
    totalArticles: (database.prepare('SELECT COUNT(*) as c FROM articles').get() as { c: number }).c,
    unprocessed: (database.prepare('SELECT COUNT(*) as c FROM articles WHERE llm_processed = 0').get() as { c: number }).c,
    published: (database.prepare('SELECT COUNT(*) as c FROM articles WHERE published = 1').get() as { c: number }).c,
    pendingPublish: (database.prepare(
      `SELECT COUNT(*) as c FROM articles WHERE llm_processed = 1 AND published = 0 AND relevance_score >= ${config.relevanceThreshold}`
    ).get() as { c: number }).c,
  }
}
