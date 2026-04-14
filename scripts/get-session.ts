import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import input from 'input'
import dotenv from 'dotenv'

dotenv.config()

const apiId = parseInt(process.env.TELEGRAM_API_ID ?? '2040', 10)
const apiHash = process.env.TELEGRAM_API_HASH ?? 'b18441a1ff607e10a989891a5462e627'

async function main() {
  console.log('Starting Telegram auth...')
  console.log(`Using API ID: ${apiId}`)

  const session = new StringSession('')

  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  })

  await client.start({
    phoneNumber: async () => await input.text('Enter your phone number (e.g. +79001234567): '),
    password: async () => await input.text('Enter 2FA password (press Enter if none): '),
    phoneCode: async () => await input.text('Enter the code from Telegram: '),
    onError: (err) => console.error('Auth error:', err),
  })

  const sessionString = (session as StringSession).save()
  console.log('\n✅ Success! Copy this to your .env:\n')
  console.log(`TELEGRAM_SESSION=${sessionString}`)
  console.log()

  await client.disconnect()
}

main().catch(console.error)
