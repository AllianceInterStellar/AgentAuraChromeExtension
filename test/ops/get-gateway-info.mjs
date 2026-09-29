function requireApiEnvPath() {
    const fp = process.env.AGENTAURA_API_ENV
    if (fp) return fp
    console.error('\nMissing AGENTAURA_API_ENV — path to the API .env these queries read DATABASE_URL from')
    console.error('  export AGENTAURA_API_ENV=/path/to/AgentAura/apps/api/.env\n')
    process.exit(2)
}

/**
 * 直接从数据库获取运行中的 claw 网关信息
 * 需要: npm i pg (在 test 目录)
 */
import { readFileSync } from 'node:fs'

function loadEnv(filepath) {
    const env = {}
    for (const line of readFileSync(filepath, 'utf8').split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const eq = t.indexOf('=')
        if (eq === -1) continue
        let val = t.slice(eq + 1).trim()
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
            val = val.slice(1, -1)
        env[t.slice(0, eq).trim()] = val
    }
    return env
}

async function main() {
    const env = loadEnv(requireApiEnvPath())
    const dbUrl = env.DATABASE_URL
    if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1) }

    const pg = await import('pg')
    const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
    console.log('Connecting to database...')
    await client.connect()

    const res = await client.query(
        "SELECT id, name, subdomain, gateway_token, status, provider FROM claws WHERE status = 'running' AND subdomain IS NOT NULL LIMIT 5"
    )

    console.log(`Found ${res.rows.length} running claw(s):\n`)

    if (res.rows.length === 0) {
        console.log('No running claws found.')
        await client.end()
        process.exit(1)
    }

    for (const row of res.rows) {
        const gUrl = `https://${row.subdomain}.digitalenginecore.com`
        console.log(`  Name: ${row.name || row.id}`)
        console.log(`  Provider: ${row.provider}`)
        console.log(`  GATEWAY_URL=${gUrl}`)
        console.log(`  GATEWAY_TOKEN=${row.gateway_token}`)
        console.log('')
    }

    const claw = res.rows[0]
    const gUrl = `https://${claw.subdomain}.digitalenginecore.com`
    const gToken = claw.gateway_token || ''

    console.log('═══════════════════════════════════════')
    console.log('运行 E2E 测试:')
    console.log(`GATEWAY_URL=${gUrl} GATEWAY_TOKEN=${gToken} /opt/homebrew/bin/node vision-e2e-test.mjs`)
    console.log('═══════════════════════════════════════')

    await client.end()
}

main().catch(e => { console.error(e); process.exit(1) })
