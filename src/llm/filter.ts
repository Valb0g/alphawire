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

Relevance score (0-10):
- 9-10: Critical breaking news (major hack >$10M, major regulatory ban, exchange collapse)
- 7-8: Important news (significant hack <$10M, new regulations, major protocol launch)
- 5-6: Notable but not urgent (medium whale moves, smaller platform news)
- 3-4: Minor news (small updates, minor platform changes)
- 1-2: Low relevance (opinion, minor price updates, ads)
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

const EDITORIAL_SYSTEM_PROMPT = `You are an expert crypto analyst running a high-quality Telegram channel.
You need to write an editorial summary and a discussion question for a highly important crypto news article (score >= 9).

Return ONLY valid JSON with this exact structure:
{
  "editorialSummaryRu": "<Your insightful, engaging summary with character and slight irony. Russian language. 3-4 sentences.>",
  "discussionQuestion": "<A provocative, engaging question to ask the audience to start a discussion in comments. Russian language.>"
}

Rules for editorialSummaryRu:
- Be serious about facts but add character and slight irony.
- No journalistic clichés. Write like a smart, experienced trader/builder pointing out what's really going on.
- Must be entirely in Russian, keeping specific crypto terms in English if appropriate.
- Example tone: 'Атакующий эксплойтнул уязвимость в мосте Wormhole... Очередной bridge exploit — классика жанра.'
- DO NOT just repeat the basic summary. Add that characteristic 'flavor'.

Rules for discussionQuestion:
- Keep it short, slightly provocative.
- Make people want to reply.
- Must be in Russian.`

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

    const titleRu = String(parsed['titleRu'] ?? '').trim()

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
    temperature: 0.7,  // Higher temperature for more creative/editorial responses
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

