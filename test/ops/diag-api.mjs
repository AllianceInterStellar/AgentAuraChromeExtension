import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import https from 'node:https'

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

async function main() {
    const pg = await import('pg')
    const client = new pg.default.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
    await client.connect()
    const res = await client.query("SELECT id, user_id, ip, provider FROM claws WHERE status = 'running' AND subdomain IS NOT NULL ORDER BY provider LIMIT 10")
    await client.end()

    for (const r of res.rows) {
        console.log(`  ${r.id.slice(0, 8)} ${r.provider} ${r.ip} user=${r.user_id.slice(0, 8)}`)
    }

    const testId = process.env.TEST_CLAW_ID
    const claw = testId ? (res.rows.find(r => r.id.startsWith(testId)) || res.rows[0]) : res.rows[0]
    console.log(`\nTesting claw: ${claw.id} (${claw.provider} ${claw.ip})`)

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
        iat: now, exp: now + 3600, uid: claw.user_id
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
    console.log('Firebase token:', fbRes.idToken ? 'OK' : 'FAIL', fbRes.error ? fbRes.error.message : '')
    if (!fbRes.idToken) { console.log('Full response:', JSON.stringify(fbRes)); return }
    const idToken = fbRes.idToken

    const API_BASE = process.env.API_URL || 'https://awsapi.allianceinterstellar.com'
    console.log('API:', API_BASE)

    console.log('\n--- GET /claws ---')
    const clawsRes = await fetch(`${API_BASE}/claws`, {
        headers: { Authorization: `Bearer ${idToken}` },
        signal: AbortSignal.timeout(15000)
    })
    console.log('Status:', clawsRes.status)
    const clawsData = await clawsRes.json()
    const arr = Array.isArray(clawsData) ? clawsData : (clawsData?.data || [])
    console.log('Total claws:', arr.length, 'Running:', arr.filter(c => c.status === 'running').length)

    console.log('\n--- POST /claws/:id/files/read (openclaw.json) ---')
    const readRes = await fetch(`${API_BASE}/claws/${claw.id}/files/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'openclaw.json' }),
        signal: AbortSignal.timeout(30000)
    })
    console.log('Status:', readRes.status)
    const readData = await readRes.text()
    console.log('Response:', readData.slice(0, 500))

    console.log('\n--- POST /claws/:id/agents/main/skills (GET skills) ---')
    const skillsRes = await fetch(`${API_BASE}/claws/${claw.id}/agents/main/skills`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(30000)
    })
    console.log('Status:', skillsRes.status)
    const skillsData = await skillsRes.text()
    console.log('Response:', skillsData.slice(0, 500))
}

main().catch(e => console.error('ERROR:', e.message))
