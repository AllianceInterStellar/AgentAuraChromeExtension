/**
 * Test configuration, read from the environment.
 *
 * These scripts drive a real, running gateway — no fixture can stand in for one. The values
 * below used to be hardcoded, which meant the repository carried a working credential for a
 * live machine: anyone who cloned it could have driven that agent. They come from the
 * environment instead, and a missing one fails immediately with an explanation rather than
 * becoming an `undefined` that resurfaces later as a confusing protocol error.
 *
 *   export AGENTAURA_GATEWAY_URL=wss://<your-subdomain>.digitalenginecore.com/
 *   export AGENTAURA_GATEWAY_TOKEN=<gateway token>
 *   export AGENTAURA_CLAW_ID=<uuid>              # only the skill/config tests need this
 */

/** The variable's value, or exit(2) with a message naming what to set and why. */
export function required(name, why) {
    const value = process.env[name]
    if (value && value.trim())
        return value.trim()
    console.error(`\nMissing ${name} — ${why}`)
    console.error(`  export ${name}=...`)
    console.error('\nThese tests drive a live gateway; see test/README.md.\n')
    process.exit(2)
}

/** Optional, non-credential value with a fallback. */
export function optional(name, fallback = '') {
    const value = process.env[name]
    return value && value.trim() ? value.trim() : fallback
}

/**
 * The gateway checks the WebSocket Origin, and it has to match the gateway's own host. It is
 * derived from the URL rather than configured separately: two settings that must agree are
 * two settings that can be made to disagree.
 */
export function originFor(gatewayUrl) {
    return `https://${new URL(gatewayUrl).host}`
}
