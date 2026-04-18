import axios, { AxiosResponse } from 'axios'
import {
  LLMFilterRequest,
  LLMFilterResponse,
  NewsCategory,
  EditorialContent,
} from '../types/index'
import { config } from '../config/index'
import { logger } from '../utils/logger'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

// Delay between LLM API calls to respect rate limits (free tier)
const INTER_REQUEST_DELAY_MS = 8000

// Maximum content length to send to LLM (to stay within context window)
const MAX_CONTENT_LENGTH = 1500

const SYSTEM_PROMPT = `You are a crypto news relevance analyst. Your task is to evaluate a news article and return a structured JSON response.

CRITICAL REQUIREMENT: The fields "titleRu" and "summaryRu" MUST be written in Russian (Cyrillic script). This is mandatory. Do not write them in English, regardless of the article language.

Evaluate the article on the following criteria:
1. Is it about significant crypto events (hacks, exploits, regulatory actions, major launches/closures, whale movements, important on-chain events)?
2. Is it factual and newsworthy (not an opinion piece, tutorial, or advertisement)?
3. Would it be important for a professional crypto trader or developer to know?

Categories:
- "security": hacks, exploits, vulnerabilities, stolen funds, smart contract bugs, rug pulls, phishing, fraud
- "platform": exchange launches/closures, protocol launches/upgrades, DeFi/NFT platform news, CEX/DEX events
- "regulatory": laws, bans, SEC/CFTC/government actions, legal proceedings, sanctions, compliance
- "onchain": whale movements, large transfers, on-chain analytics, liquidations, unusual on-chain activity
- "general": important crypto news that doesn't fit the above (market crashes, major partnerships, bitcoin ETF, macro events)

Relevance score (0-10). Be strict — most articles should score 5-7. Reserve 9-10 for truly catastrophic events.
- 10: Once-in-a-year level event: exchange collapse (FTX-scale), $500M+ hack, major country-wide crypto ban
- 9: Major hack >$50M, top-5 exchange or protocol critical failure, systemic risk to DeFi
- 7-8: Significant hack $5M–$50M, important regulatory action, major protocol launch/upgrade
- 5-6: Notable news: smaller hacks <$5M, whale movements, platform updates, regulatory filings
- 3-4: Minor news: small updates, minor partnerships, low-impact regulatory news
- 1-2: Low relevance: opinion pieces, minor price updates, ads, tutorials
- 0: Not crypto news or spam

Rules for titleRu and summaryRu:
- Язык вывода: русский.
- titleRu: переведи заголовок на русский язык (если уже на английском — оставь на английском). Без CJK-символов (китайских/японских/корейских). Максимум 120 символов.
- summaryRu: 2-3 предложения, максимум 300 символов.
- Сохраняй точные числа, суммы в USD, версии протоколов, названия проектов/токенов без изменений.
- Стиль: деловой и нейтральный, как у опытного крипто-аналитика. Без журналистских клише ("эксперты считают", "по данным источников", "стратегический сдвиг", "индустрия наблюдает"). Без пафоса и лишних прилагательных. Только факты: кто, что сделал, сколько, когда.
- Все слова в summaryRu должны быть полностью на русском или полностью на английском. Нельзя мешать языки внутри одного слова (например "broker-dealer'стве" или "дисклоsurement" — это неправильно). Пиши "незарегистрированный брокер-дилер" или просто используй английский термин отдельным словом: "broker-dealer".
- Пример хорошего: "Hacker drained $47M from Euler Finance через flash loan атаку. Средства уже частично заморожены через USDC blacklist. Команда работает с BlockSec над расследованием."
- Пример плохого: "Произошёл значительный инцидент безопасности, который потряс криптовалютное сообщество и вызвал серьёзные вопросы о безопасности DeFi."

Return ONLY valid JSON with this exact structure:
{
  "relevanceScore": <number 0-10>,
  "category": "<security|platform|regulatory|onchain|general>",
  "titleRu": "<translated title in Russian or English, max 120 chars, no CJK>",
  "summaryRu": "<2-3 sentences in Russian, max 300 characters>",
  "reasoning": "<1 sentence explaining your score in English>"
}`

const EDITORIAL_SYSTEM_PROMPT = `You are a senior crypto analyst writing for a professional Telegram channel.
Your task: write an expanded analytical summary and a discussion question for a critical crypto news article.

CRITICAL REQUIREMENT: Both fields MUST be written entirely in Russian (Cyrillic script). No exceptions.
No CJK characters (Chinese/Japanese/Korean). No hybrid words mixing Russian and non-Russian letters inside one word.

Return ONLY valid JSON with this exact structure:
{
  "editorialSummaryRu": "<3-4 sentences in Russian. Factual, analytical, professional.>",
  "discussionQuestion": "<1 concise question in Russian to spark discussion.>"
}

Rules for editorialSummaryRu:
- Tone: professional and analytical — like a senior researcher or experienced builder, not a journalist or blogger.
- No sarcasm, no irony, no informal language ("джентльмен", "казино", "арт-объект").
- Do NOT editorialize: no "what's really going on", no conspiracy framing, no rhetorical flourishes.
- Expand beyond the basic facts: add context (e.g. attack vector details, what was and wasn't affected, what happens next).
- Preserve exact numbers, names, amounts unchanged.
- Good example: "Эксплойт в Hyperbridge gateway-контракте на Ethereum позволил атакующему создать 1B DOT. Основная сеть Polkadot не затронута — уязвимость была изолирована в bridge-контракте. CertiK зафиксировал аномальные транзакции; bridge приостановлен до выхода патча. Это четвёртый крупный bridge exploit в 2025 году."
- Bad example: "Атакующий просто взял и минтанул... Polkadot, как истинный джентльмен, заявляет..." — никогда так не писать.

Rules for discussionQuestion:
- One short, genuine question that invites a professional discussion.
- Not rhetorical, not leading. Real question with no obvious answer.
- Russian only. Max 120 characters.
- Good example: "Можно ли вообще сделать cross-chain bridge безопасным, или это структурно нерешаемая задача?"
- Bad example: "Зачем вообще доверять этим мошенникам?" — никогда так не писать.`

function buildUserPrompt(request: LLMFilterRequest): string {
  const truncatedContent = request.content.substring(0, MAX_CONTENT_LENGTH)
  return `Article Title: ${request.title}
Source: ${request.sourceName}
Content: ${truncatedContent}

Analyze this article and return the JSON response.`
}

const VALID_CATEGORIES = new Set<NewsCategory>([
  'security', 'platform', 'regulatory', 'onchain', 'general',
])

/**
 * Validates and sanitizes the LLM response JSON.
 * Returns null if the response is invalid or cannot be parsed.
 */
function parseAndValidateLLMResponse(rawText: string): LLMFilterResponse | null {
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      logger.warn(`LLM response contains no JSON: ${rawText.substring(0, 200)}`)
      return null
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>

    const score = Number(parsed['relevanceScore'])
    if (isNaN(score) || score < 0 || score > 10) {
      logger.warn(`LLM returned invalid relevanceScore: ${parsed['relevanceScore']}`)
      return null
    }

    const category = parsed['category'] as string
    if (!VALID_CATEGORIES.has(category as NewsCategory)) {
      logger.warn(`LLM returned invalid category: ${category}`)
      return null
    }

    const summaryRu = String(parsed['summaryRu'] ?? '').trim()
    if (summaryRu.length < 10) {
      logger.warn(`LLM returned empty summaryRu`)
      return null
    }

    // Validate Russian output: must contain at least some Cyrillic characters
    const hasCyrillic = /[а-яёА-ЯЁ]/.test(summaryRu)
    if (!hasCyrillic) {
      logger.warn(`LLM returned summaryRu in non-Russian language: "${summaryRu.substring(0, 80)}"`)
      return null
    }

    // Reject CJK characters in summaryRu or titleRu → triggers retry
    const cjkPattern = /[\u2E80-\u2EFF\u3000-\u9FFF\uF900-\uFAFF]/
    const titleRu = String(parsed['titleRu'] ?? '').trim()
    if (cjkPattern.test(summaryRu) || cjkPattern.test(titleRu)) {
      logger.warn(`LLM returned CJK chars in summaryRu/titleRu — retrying`)
      return null
    }

    return {
      relevanceScore: score,
      category: category as NewsCategory,
      titleRu: titleRu || '',
      summaryRu,
      reasoning: String(parsed['reasoning'] ?? ''),
    }
  } catch (error) {
    logger.warn(`Failed to parse LLM response JSON: ${error}`)
    return null
  }
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OpenRouterRequest {
  model: string
  messages: OpenRouterMessage[]
  temperature: number
  max_tokens: number
  response_format?: { type: 'json_object' }
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
  }
}

/**
 * Sends a single article to MiniMax M2.5 via OpenRouter for relevance filtering.
 * Returns null if the LLM call fails or returns invalid data.
 * Implements retry logic with 1 retry on failure.
 */
export async function filterArticleWithLLM(
  request: LLMFilterRequest,
  retries = 1
): Promise<LLMFilterResponse | null> {
  const requestBody: OpenRouterRequest = {
    model: config.openRouter.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(request) },
    ],
    temperature: 0.1,  // Low temperature for consistent structured output
    max_tokens: 1000,
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response: AxiosResponse<OpenRouterResponse> = await axios.post(
        OPENROUTER_API_URL,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${config.openRouter.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/Valb0g/alphawire',
            'X-Title': 'AlphaWire',
          },
          timeout: 60000,
        }
      )

      const content = response.data?.choices?.[0]?.message?.content
      if (!content) {
        logger.warn(`LLM returned empty content for: ${request.title.substring(0, 50)}`)
        continue
      }

      const result = parseAndValidateLLMResponse(content)
      if (result) {
        logger.debug(
          `LLM scored "${request.title.substring(0, 50)}" → ${result.relevanceScore}/10 [${result.category}]`
        )
        return result
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status
        logger.error(`LLM API error (status ${status}): ${error.message}`)

        // Don't retry on client errors (400, 401, 422)
        if (status && status >= 400 && status < 500) {
          return null
        }
      } else {
        logger.error(`LLM unexpected error: ${error}`)
      }

      if (attempt < retries) {
        logger.info(`Retrying LLM call (attempt ${attempt + 1}/${retries})...`)
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    }
  }

  return null
}

/**
 * Validates and sanitizes the LLM response JSON for editorial content.
 */
function parseAndValidateEditorialResponse(rawText: string): EditorialContent | null {
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      logger.warn(`LLM editorial response contains no JSON: ${rawText.substring(0, 200)}`)
      return null
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>

    const editorialSummaryRu = String(parsed['editorialSummaryRu'] ?? '').trim()
    const discussionQuestion = String(parsed['discussionQuestion'] ?? '').trim()

    if (editorialSummaryRu.length < 10 || discussionQuestion.length < 5) {
      logger.warn(`LLM returned empty editorial content`)
      return null
    }

    // Must be in Russian
    if (!/[а-яёА-ЯЁ]/.test(editorialSummaryRu)) {
      logger.warn(`Editorial summaryRu is not in Russian: "${editorialSummaryRu.substring(0, 80)}"`)
      return null
    }

    // Must not contain CJK characters
    const cjkPattern = /[\u2E80-\u2EFF\u3000-\u9FFF\uF900-\uFAFF]/
    if (cjkPattern.test(editorialSummaryRu) || cjkPattern.test(discussionQuestion)) {
      logger.warn(`Editorial content contains CJK characters — retrying`)
      return null
    }

    return {
      editorialSummaryRu,
      discussionQuestion,
    }
  } catch (error) {
    logger.warn(`Failed to parse LLM editorial response JSON: ${error}`)
    return null
  }
}

/**
 * Generates editorial content for alpha articles (score >= 9).
 */
export async function generateEditorialContent(
  request: LLMFilterRequest,
  retries = 1
): Promise<EditorialContent | null> {
  const requestBody: OpenRouterRequest = {
    model: config.openRouter.model,
    messages: [
      { role: 'system', content: EDITORIAL_SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(request) },
    ],
    temperature: 0.3,  // Moderate temperature for analytical but consistent output
    max_tokens: 800,
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response: AxiosResponse<OpenRouterResponse> = await axios.post(
        OPENROUTER_API_URL,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${config.openRouter.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/Valb0g/alphawire',
            'X-Title': 'AlphaWire',
          },
          timeout: 60000,
        }
      )

      const content = response.data?.choices?.[0]?.message?.content
      if (!content) {
        logger.warn(`LLM returned empty editorial content for: ${request.title.substring(0, 50)}`)
        continue
      }

      const result = parseAndValidateEditorialResponse(content)
      if (result) {
        logger.debug(
          `Generated editorial content for: "${request.title.substring(0, 50)}"`
        )
        return result
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status
        logger.error(`LLM API error (status ${status}): ${error.message}`)
        if (status && status >= 400 && status < 500) {
          return null
        }
      } else {
        logger.error(`LLM unexpected error: ${error}`)
      }

      if (attempt < retries) {
        logger.info(`Retrying LLM editorial call (attempt ${attempt + 1}/${retries})...`)
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    }
  }

  return null
}

