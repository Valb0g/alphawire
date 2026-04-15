/**
 * Model comparison test: Nemotron vs Elephant-alpha
 * Tests both models on two complex crypto articles and prints side-by-side results.
 */
import axios from 'axios'
import dotenv from 'dotenv'
dotenv.config()

const API_KEY = process.env.OPENROUTER_API_KEY!
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

const SYSTEM_PROMPT = `You are a crypto news relevance analyst. Your task is to evaluate a news article and return a structured JSON response.

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
- Пример хорошего: "Hacker drained $47M из Euler Finance через flash loan атаку. Средства уже частично заморожены через USDC blacklist. Команда работает с BlockSec над расследованием."
- Пример плохого: "Произошёл значительный инцидент безопасности, который потряс криптовалютное сообщество и вызвал серьёзные вопросы о безопасности DeFi."

Return ONLY valid JSON with this exact structure:
{
  "relevanceScore": <number 0-10>,
  "category": "<security|platform|regulatory|onchain|general>",
  "titleRu": "<translated title in Russian or English, max 120 chars, no CJK>",
  "summaryRu": "<2-3 sentences in Russian, max 300 characters>",
  "reasoning": "<1 sentence explaining your score in English>"
}`

// Two complex test cases
const TEST_ARTICLES = [
  {
    label: 'ARTICLE 1 — Complex hack with multiple protocols, precise numbers',
    title: 'Ronin Network hacker returns $10M in ETH and USDC after on-chain negotiation, keeps $6.4M as "bug bounty"',
    sourceName: 'The Block',
    content: `The hacker behind the Ronin Network exploit has returned approximately $10 million worth of ETH and USDC to the Ronin bridge contract following an on-chain negotiation. The attacker drained a total of $12 million on August 6 by exploiting a vulnerability in the Ronin bridge's MEV bot configuration — specifically, a bug in how the bridge handled slippage parameters during sandwich attacks.

In a series of on-chain messages, the Ronin team offered the attacker a 10% white-hat bounty ($1.2M) to return the remaining funds. The hacker countered, ultimately keeping $6.4 million as a "bug bounty" and returning the rest. The returned funds consist of 3,991 ETH ($9.8M at current prices) and 2 USDC.

Sky Mavis, the company behind Ronin and Axie Infinity, confirmed the recovery and stated it would not pursue legal action against the attacker. Ronin bridge v3 had been audited by Veridise and Certora in Q1 2024 but the specific MEV-related bug was introduced in a subsequent update in July 2024.`,
  },
  {
    label: 'ARTICLE 2 — Regulatory action with multiple jurisdictions and token impact',
    title: 'SEC charges Consensys with unregistered securities offering via MetaMask Swaps and Staking, seeks $65M penalty',
    sourceName: 'CoinTelegraph',
    content: `The U.S. Securities and Exchange Commission has filed charges against Consensys Software Inc., alleging the company operated as an unregistered broker-dealer through its MetaMask Swaps service and offered unregistered securities via MetaMask Staking. The SEC is seeking disgorgement of $65 million in fees collected since 2020.

The charges specifically target two MetaMask products: Swaps, which aggregates DEX liquidity and charges a 0.875% fee on each transaction, and Staking, which allows users to stake ETH through Lido and Rocket Pool directly in the MetaMask interface. The SEC alleges these constitute brokerage services for securities.

Consensys called the charges "a regulatory overreach" and announced it would fight the SEC in court. The company noted MetaMask Swaps has processed over $23 billion in transactions since launch. The case follows Consensys's earlier lawsuit against the SEC filed in April 2024, in which Consensys sought a declaratory judgment that ETH is not a security. ETH price dropped 3.2% on the news. The New York District Court is expected to hear the case in Q3 2025.`,
  },
]

async function testModel(model: string, article: typeof TEST_ARTICLES[0]): Promise<{ raw: string; parsed: Record<string, unknown> | null; latencyMs: number; reasoningTokens: number }> {
  const start = Date.now()
  try {
    const resp = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/Valb0g/alphawire',
        'X-Title': 'AlphaWire',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Article Title: ${article.title}\nSource: ${article.sourceName}\nContent: ${article.content}\n\nAnalyze this article and return the JSON response.` },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
      signal: AbortSignal.timeout(90000),
    })

    const data = await resp.json() as Record<string, unknown>
    const latencyMs = Date.now() - start
    const choices = data['choices'] as Array<{ message: { content: string } }> | undefined
    const usage = data['usage'] as Record<string, unknown> | undefined
    const completionDetails = usage?.['completion_tokens_details'] as Record<string, unknown> | undefined
    const reasoningTokens = Number(completionDetails?.['reasoning_tokens'] ?? 0)

    const raw = choices?.[0]?.message?.content ?? ''
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    let parsed: Record<string, unknown> | null = null
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]) } catch { parsed = null }
    }
    return { raw, parsed, latencyMs, reasoningTokens }
  } catch (e: unknown) {
    const latencyMs = Date.now() - start
    const msg = e instanceof Error ? e.message : String(e)
    return { raw: `ERROR: ${msg}`, parsed: null, latencyMs, reasoningTokens: 0 }
  }
}

const MODELS = [
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super 120B' },
  { id: 'openrouter/elephant-alpha',              label: 'Elephant-alpha' },
]

const DIVIDER = '═'.repeat(72)
const THIN    = '─'.repeat(72)

async function main() {
  console.log(`\n${DIVIDER}`)
  console.log('  MODEL COMPARISON: Nemotron 3 Super 120B  vs  Elephant-alpha')
  console.log(DIVIDER)

  for (const article of TEST_ARTICLES) {
    console.log(`\n📰 ${article.label}`)
    console.log(`   Title: "${article.title}"`)
    console.log(THIN)

    for (const model of MODELS) {
      console.log(`\n🤖 ${model.label}`)
      const result = await testModel(model.id, article)
      console.log(`   Latency: ${result.latencyMs}ms  |  Reasoning tokens: ${result.reasoningTokens}`)

      if (result.parsed) {
        const p = result.parsed
        console.log(`   Score:    ${p['relevanceScore']}/10`)
        console.log(`   Category: ${p['category']}`)
        console.log(`   titleRu:  ${p['titleRu']}`)
        console.log(`   summaryRu:\n     ${String(p['summaryRu']).replace(/\n/g, '\n     ')}`)
        console.log(`   Reasoning: ${p['reasoning']}`)
      } else {
        console.log(`   ❌ PARSE FAILED. Raw response:`)
        console.log(`     ${result.raw.substring(0, 500)}`)
      }

      // Delay to avoid rate limits
      if (model.id !== MODELS[MODELS.length - 1]!.id) {
        await new Promise(r => setTimeout(r, 5000))
      }
    }
    console.log(`\n${THIN}`)
    await new Promise(r => setTimeout(r, 5000))
  }

  console.log(`\n${DIVIDER}\n`)
}

main().catch(console.error)
