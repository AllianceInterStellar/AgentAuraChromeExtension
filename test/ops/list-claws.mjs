import { readFileSync } from 'node:fs'
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
const pg = await import('pg')
const client = new pg.default.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
const res = await client.query("SELECT id, name, ip, provider, status FROM claws WHERE status = 'running' AND subdomain IS NOT NULL")
await client.end()
for (const r of res.rows) console.log(r.id.slice(0, 8), r.provider, r.ip, r.status)
