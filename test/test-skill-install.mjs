import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import https from 'node:https'

import { required, originFor } from './env.mjs'

function loadEnv(fp) {
    const env = {}
    for (const l of readFileSync(fp, 'utf8').split('\n')) {
        const t = l.trim()
        if (!t || t.startsWith('#')) continue
        const eq = t.indexOf('=')
        if (eq < 0) continue
        let v = t.slice(eq + 1).trim()
        if ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))
            v = v.slice(1, -1)
        env[t.slice(0, eq).trim()] = v
    }
    return env
}

function requireApiEnvPath() {
    const fp = process.env.AGENTAURA_API_ENV
    if (fp) return fp
    console.error('\nMissing AGENTAURA_API_ENV — path to the API .env these queries read DATABASE_URL from')
    console.error('  export AGENTAURA_API_ENV=/path/to/AgentAura/apps/api/.env\n')
    process.exit(2)
}

const env = loadEnv(requireApiEnvPath())
const FIREBASE_API_KEY = 'AIzaSyBdKqX4ZPKnw1sM1c09_dGtiBJlFV13iSs'
const API_BASE = process.env.API_URL || 'https://uuiv4wr33ebukwv5yfcgjy22ia0sivfm.lambda-url.us-east-1.on.aws'
const CLAW_ID = required('AGENTAURA_CLAW_ID', 'the claw UUID these tests act on')
const USER_ID = 'ox0veMwxBqX4AhxaOPnTQFFvATm1'

async function getToken() {
    const { SocksProxyAgent } = await import('socks-proxy-agent')
    const agent = new SocksProxyAgent('socks5h://127.0.0.1:22334')
    let pk = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    const b64 = pk.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
    const keyBuf = Buffer.from(b64, 'base64')
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const payload = Buffer.from(JSON.stringify({
        iss: env.FIREBASE_CLIENT_EMAIL, sub: env.FIREBASE_CLIENT_EMAIL,
        aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
        iat: now, exp: now + 3600, uid: USER_ID
    })).toString('base64url')
    const sigInput = `${header}.${payload}`
    const key = await webcrypto.subtle.importKey('pkcs8', keyBuf, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
    const sig = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput))
    const customToken = `${sigInput}.${Buffer.from(sig).toString('base64url')}`
    const fbRes = await new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'identitytoolkit.googleapis.com',
            path: `/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
            method: 'POST', agent,
            headers: { 'Content-Type': 'application/json' }
        }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(JSON.parse(d))) })
        req.on('error', reject)
        req.write(JSON.stringify({ token: customToken, returnSecureToken: true }))
        req.end()
    })
    return fbRes.idToken
}

async function main() {
    const token = await getToken()
    console.log('Token:', token ? 'OK' : 'FAIL')

    const skillContent = `# Browser Automation

This skill enables the AI agent to control a web browser for tasks like web scraping, form filling, testing, and general web automation.

## Capabilities

- Navigate to URLs
- Click elements by CSS selector or text content
- Type text into input fields
- Extract text content from pages
- Take screenshots
- Wait for elements to appear
- Execute JavaScript in page context

## Usage

When the user asks to interact with a website, use the browser automation actions. Available actions:

- \`browser.navigate\` - Go to a URL
- \`browser.click\` - Click an element
- \`browser.type\` - Type into an input
- \`browser.extract\` - Get text from elements
- \`browser.screenshot\` - Capture the page
- \`browser.wait\` - Wait for an element
- \`browser.eval\` - Run JavaScript

## Response Format

Wrap browser actions in action blocks:

\`\`\`action:browser.navigate
{"url": "https://example.com"}
\`\`\`

\`\`\`action:browser.click
{"selector": "#submit-button"}
\`\`\`

\`\`\`action:browser.type
{"selector": "#search-input", "text": "search query"}
\`\`\`
`

    console.log('\n--- PUT /claws/:id/agents/main/skills (INSTALL) ---')
    const installRes = await fetch(`${API_BASE}/claws/${CLAW_ID}/agents/main/skills`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillName: 'browser-automation', action: 'install', content: skillContent }),
        signal: AbortSignal.timeout(90000)
    })
    console.log('Status:', installRes.status)
    const data = await installRes.text()
    console.log('Response:', data.slice(0, 500))

    if (installRes.status !== 200) {
        console.log('Skill install failed, skipping verification')
        return
    }

    // verify
    console.log('\n--- Verify SKILL.md ---')
    const verifyRes = await fetch(`${API_BASE}/claws/${CLAW_ID}/files/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'agents/main/workspace/skills/browser-automation/SKILL.md' }),
        signal: AbortSignal.timeout(30000)
    })
    console.log('Status:', verifyRes.status)
    const verifyData = await verifyRes.json()
    if (verifyData.data?.content) {
        console.log('SKILL.md length:', verifyData.data.content.length)
        console.log('First 200 chars:', verifyData.data.content.slice(0, 200))
    } else {
        console.log('Response:', JSON.stringify(verifyData).slice(0, 500))
    }

    // verify openclaw.json
    console.log('\n--- Verify openclaw.json skills ---')
    const configRes = await fetch(`${API_BASE}/claws/${CLAW_ID}/files/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'openclaw.json' }),
        signal: AbortSignal.timeout(30000)
    })
    const configData = await configRes.json()
    if (configData.data?.content) {
        const config = JSON.parse(configData.data.content)
        console.log('skills.entries:', JSON.stringify(config.skills?.entries || 'NOT FOUND'))
    }
}

main().catch(e => console.error('ERROR:', e.message))
