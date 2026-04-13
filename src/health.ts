import http from 'http'
import { logger } from './utils/logger.js'

export function startHealthServer(port: number = 3000): void {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }))
    } else {
      res.writeHead(404)
      res.end()
    }
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`Port ${port} is already in use, health server skipped`)
    } else {
      logger.error(`Health server error: ${err.message}`)
    }
  })

  server.listen(port, () => {
    logger.info(`Health server listening on port ${port}`)
  })
}
