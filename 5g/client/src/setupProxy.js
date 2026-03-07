/**
 * src/setupProxy.js
 *
 * MUST be at exactly: src/setupProxy.js  (CRA auto-loads it on `npm start`)
 *
 * REQUIREMENT: http-proxy-middleware must be installed (CRA needs it to
 * activate this file at all, even if you don't use its proxy features).
 *
 *   npm install http-proxy-middleware
 *
 * If you see no "[citylearn-5g] proxy ready" line in the terminal after
 * `npm start`, the package is missing — that's the only reason CRA skips
 * this file.
 */

const fs   = require('fs')
const path = require('path')

// Absolute path so it works regardless of where npm start is run from.
// Override with env var if your docker-compose lives elsewhere:
//   CITYLEARN_STATE_FILE=/some/other/path/buildings.txt npm start
const STATE_FILE = process.env.CITYLEARN_STATE_FILE
  || path.resolve(__dirname, '..', 'state', 'buildings.txt')

// Create state/ directory and seed the file before the first slider move
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
if (!fs.existsSync(STATE_FILE)) {
  fs.writeFileSync(STATE_FILE, '0', 'utf8')
}

module.exports = function (app) {

  // Confirm the file loaded — visible in the `npm start` terminal
  console.log('\x1b[36m[citylearn-5g]\x1b[0m proxy ready — state file:', STATE_FILE)

  // CRA dev server does NOT auto-parse request bodies — collect raw chunks manually
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data',  chunk => { data += chunk })
      req.on('end',   ()    => resolve(data))
      req.on('error', err   => reject(err))
    })
  }

  // ── GET /api/buildings ─────────────────────────────────────────────────────
  // Returns the persisted count.
  // Test with:  curl http://localhost:3000/api/buildings
  app.get('/api/buildings', (_req, res) => {
    try {
      const n = parseInt(fs.readFileSync(STATE_FILE, 'utf8').trim(), 10) || 0
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ buildings: n }))
    } catch {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ buildings: 0 }))
    }
  })

  // ── POST /api/buildings ────────────────────────────────────────────────────
  // Called by useBuildingSync hook whenever the slider settles (debounced 500ms).
  // Body: application/json  { "buildings": N }
  app.post('/api/buildings', async (req, res) => {
    try {
      const raw = await readBody(req)

      // Accept JSON { "buildings": N } or plain integer string
      let count
      try {
        const parsed = JSON.parse(raw)
        count = Number(
          parsed.buildings !== undefined ? parsed.buildings
          : parsed.count   !== undefined ? parsed.count
          : parsed
        )
      } catch {
        count = Number(raw.trim())
      }

      if (!Number.isFinite(count) || count < 0) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        return res.end(JSON.stringify({ error: 'buildings must be a non-negative integer' }))
      }

      // Clamp to the max supported by docker-compose.yml (20 buildings)
      const clamped = Math.min(20, Math.max(0, Math.round(count)))

      // Atomic write — prevents partial reads by the polling scaling script
      const tmp = STATE_FILE + '.tmp'
      fs.writeFileSync(tmp, String(clamped), 'utf8')
      fs.renameSync(tmp, STATE_FILE)

      const note = count > 20 ? ` (clamped from ${count})` : ''
      console.log(`\x1b[36m[citylearn-5g]\x1b[0m buildings → \x1b[33m${clamped}\x1b[0m${note}`)

      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ buildings: clamped, synced: true }))
    } catch (err) {
      console.error('[citylearn-5g] Error writing state file:', err)
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Failed to persist building count' }))
    }
  })
}