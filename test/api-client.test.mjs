/**
 * ApiClient, against a fetch stub. What matters: a 401 gets one refresh-and-replay with the
 * new token, then gives up as ApiError 401; a dead network is ApiError NETWORK, a stuck
 * request is TIMEOUT; read methods throw instead of returning an empty list that looks like
 * "no instances"; a forced delete is a different request from an ordinary one.
 *
 *   node --test test/api-client.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadScripts } from './helpers/load.mjs'

/** The body the backend's fail()/ok() helpers send. */
function reply(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 500 ? 'Internal Server Error' : '',
        json: async () => {
            if (body === undefined) throw new SyntaxError('no body')
            return body
        },
    }
}

/**
 * js/api.js loaded with `respond(url, options, n)` answering the n-th fetch. Returns the
 * client, the ApiError class from the script's realm and the requests that were made.
 */
function loadApi(respond) {
    const requests = []
    const { run } = loadScripts(['js/utils.js', 'js/api.js'], {
        globals: {
            fetch: async (url, options) => {
                requests.push({ url, options, path: new URL(url).pathname + new URL(url).search })
                return respond(url, options, requests.length)
            },
        },
    })
    return {
        requests,
        client: run('new ApiClient()'),
        ApiError: run('ApiError'),
        isAuthExpired: run('isAuthExpired'),
        isOneAgentLimitRefusal: run('isOneAgentLimitRefusal'),
    }
}

const authHeader = (request) => request.options.headers.Authorization

test('every request carries JSON headers and the bearer token when there is one', async () => {
    const api = loadApi(() => reply(200, { success: true, data: [] }))
    await api.client.getClaws()
    assert.equal(api.requests[0].options.headers['Content-Type'], 'application/json')
    assert.equal(api.requests[0].options.headers.Accept, 'application/json')
    assert.equal(authHeader(api.requests[0]), undefined, 'no token, no Authorization header')

    api.client.setAuthToken('tok-1')
    await api.client.getClaws()
    assert.equal(authHeader(api.requests[1]), 'Bearer tok-1')
})

test('a POST sends its body as JSON, a GET sends none', async () => {
    const api = loadApi(() => reply(200, { success: true, data: { id: 'claw-1' } }))
    await api.client.createClaw({ planId: 'cx22', name: 'my-claw', provider: 'hetzner' })
    const [post] = api.requests
    assert.equal(post.options.method, 'POST')
    assert.equal(post.path, '/claws')
    assert.deepEqual(JSON.parse(post.options.body), { planId: 'cx22', name: 'my-claw', provider: 'hetzner' })

    await api.client.getClaws()
    assert.equal(api.requests[1].options.method, 'GET')
    assert.equal(api.requests[1].options.body, undefined)
})

test('a 401 is retried once with the token onUnauthorized produced', async () => {
    const api = loadApi((_, __, n) => n === 1
        ? reply(401, { success: false, message: 'expired' })
        : reply(200, { success: true, data: [{ id: 'claw-1' }] }))
    api.client.setAuthToken('stale')
    let refreshes = 0
    api.client.onUnauthorized = async () => { refreshes++; return 'fresh' }

    const claws = await api.client.getClaws()

    assert.deepEqual(claws.map(c => c.id), ['claw-1'])
    assert.equal(refreshes, 1)
    assert.equal(api.requests.length, 2)
    assert.equal(authHeader(api.requests[0]), 'Bearer stale')
    assert.equal(authHeader(api.requests[1]), 'Bearer fresh', 'the replay carries the new token')
    assert.equal(api.requests[1].options.method, api.requests[0].options.method)
    assert.equal(api.requests[1].path, api.requests[0].path)
    assert.equal(api.client.authToken, 'fresh', 'the client keeps the new token for later calls')
})

test('the replay is not itself retried: two 401s in a row are the end of the session', async () => {
    const api = loadApi(() => reply(401, { success: false, message: 'still expired' }))
    api.client.setAuthToken('stale')
    let refreshes = 0
    api.client.onUnauthorized = async () => { refreshes++; return `fresh-${refreshes}` }

    await assert.rejects(api.client.getClaws(), (e) => {
        assert.ok(e instanceof api.ApiError, 'throws an ApiError')
        assert.equal(e.status, 401)
        assert.equal(e.code, 'UNAUTHORIZED')
        assert.equal(e.message, 'still expired')
        assert.equal(api.isAuthExpired(e), true)
        return true
    })
    assert.equal(refreshes, 1, 'onUnauthorized is asked once, not in a loop')
    assert.equal(api.requests.length, 2)
})

test('onUnauthorized returning null means sign in again: ApiError 401, no replay', async () => {
    const api = loadApi(() => reply(401, { success: false, message: 'expired' }))
    api.client.setAuthToken('stale')
    api.client.onUnauthorized = async () => null

    await assert.rejects(api.client.getClaws(), (e) => {
        assert.ok(e instanceof api.ApiError)
        assert.equal(e.status, 401)
        assert.equal(e.method, 'GET')
        assert.equal(e.path, '/claws')
        assert.equal(api.isAuthExpired(e), true)
        return true
    })
    assert.equal(api.requests.length, 1)
    assert.equal(api.client.authToken, 'stale', 'a failed refresh does not clobber the token')
})

test('an onUnauthorized that throws is treated like one that returned null', async () => {
    const api = loadApi(() => reply(401, { success: false, message: 'expired' }))
    api.client.onUnauthorized = async () => { throw new Error('refresh exploded') }
    await assert.rejects(api.client.getClaws(), (e) => e.status === 401 && e.message === 'expired')
    assert.equal(api.requests.length, 1)
})

test('without onUnauthorized a 401 is simply a 401', async () => {
    const api = loadApi(() => reply(401, { success: false, message: 'expired' }))
    await assert.rejects(api.client.getClaws(), (e) => e.status === 401)
    assert.equal(api.requests.length, 1)
})

test('a network failure is ApiError NETWORK with status 0 and the original message', async () => {
    const api = loadApi(() => { throw new TypeError('Failed to fetch') })
    await assert.rejects(api.client.getClaws(), (e) => {
        assert.ok(e instanceof api.ApiError)
        assert.equal(e.status, 0)
        assert.equal(e.code, 'NETWORK')
        assert.equal(e.message, 'Failed to fetch')
        assert.equal(e.method, 'GET')
        assert.equal(e.path, '/claws')
        assert.equal(api.isAuthExpired(e), false)
        return true
    })
})

test('a request that never answers is aborted and reported as TIMEOUT', async () => {
    const api = loadApi((_, options) => new Promise((__, reject) => {
        options.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
        })
    }))
    api.client.timeoutMs = 20
    await assert.rejects(api.client.getClaws(), (e) => {
        assert.equal(e.code, 'TIMEOUT')
        assert.equal(e.status, 0)
        assert.equal(e.message, 'Request timed out')
        return true
    })
})

test('getClaws throws on a 5xx instead of returning an empty list', async () => {
    const api = loadApi(() => reply(500, { success: false, message: 'db is down' }))
    await assert.rejects(api.client.getClaws(), (e) => {
        assert.ok(e instanceof api.ApiError)
        assert.equal(e.status, 500)
        assert.equal(e.code, 'HTTP_500')
        assert.equal(e.message, 'db is down')
        return true
    })
})

test('an error body without a message falls back to the status line', async () => {
    const api = loadApi(() => reply(503))
    await assert.rejects(api.client.getClaws(), (e) => e.status === 503 && /API Error: 503/.test(e.message))
    const withError = loadApi(() => reply(400, { error: 'Invalid server type.' }))
    await assert.rejects(withError.client.getClaws(), (e) => e.message === 'Invalid server type.')
})

test('getClaws accepts both response shapes and returns a list', async () => {
    let body
    const api = loadApi(() => reply(200, body))
    body = { success: true, data: [{ id: 'a' }, { id: 'b' }] }
    assert.deepEqual((await api.client.getClaws()).map(c => c.id), ['a', 'b'])
    body = { claws: [{ id: 'c' }] }
    assert.deepEqual((await api.client.getClaws()).map(c => c.id), ['c'])
    body = { success: true, data: null }
    assert.deepEqual([...await api.client.getClaws()], [])
    body = {}
    assert.deepEqual([...await api.client.getClaws()], [])
})

test('deleteClaw hits /claws/:id, and /force only when asked', async () => {
    const api = loadApi(() => reply(204))
    assert.equal(await api.client.deleteClaw('claw-1'), true)
    assert.equal(await api.client.deleteClaw('claw-1', {}), true)
    assert.equal(await api.client.deleteClaw('claw-1', { force: false }), true)
    assert.equal(await api.client.deleteClaw('claw-1', { force: true }), true)
    assert.deepEqual(api.requests.map(r => [r.options.method, r.path]), [
        ['DELETE', '/claws/claw-1'],
        ['DELETE', '/claws/claw-1'],
        ['DELETE', '/claws/claw-1'],
        ['DELETE', '/claws/claw-1/force'],
    ])
})

test('a failed ordinary delete does not turn into a forced one', async () => {
    const api = loadApi(() => reply(409, { success: false, message: 'still provisioning' }))
    await assert.rejects(api.client.deleteClaw('claw-1'), (e) => e.status === 409)
    assert.deepEqual(api.requests.map(r => r.path), ['/claws/claw-1'])
})

test('ids are URL-encoded into the path', async () => {
    const api = loadApi(() => reply(200, { success: true, data: {} }))
    await api.client.getClaw('a/b c')
    await api.client.startClaw('x?y')
    assert.deepEqual(api.requests.map(r => r.path), ['/claws/a%2Fb%20c', '/claws/x%3Fy/start'])
})

test('a 204 resolves to null and the mutation helpers report true', async () => {
    const api = loadApi(() => reply(204))
    assert.equal(await api.client._request('POST', '/claws/x/stop'), null)
    assert.equal(await api.client.stopClaw('x'), true)
    assert.equal(await api.client.restartClaw('x'), true)
})

test('ApiError codes follow the status when none is given', () => {
    const { ApiError } = loadApi(() => reply(200, {}))
    assert.equal(new ApiError('m', { status: 401 }).code, 'UNAUTHORIZED')
    assert.equal(new ApiError('m', { status: 0 }).code, 'NETWORK')
    assert.equal(new ApiError('m', { status: 404 }).code, 'HTTP_404')
    assert.equal(new ApiError('m', { status: 404, code: 'CUSTOM' }).code, 'CUSTOM')
    assert.equal(new ApiError('m').name, 'ApiError')
    assert.ok(new ApiError('m') instanceof ApiError)
})

test('isOneAgentLimitRefusal is a 402 to POST /claws and nothing else', async () => {
    const api = loadApi(() => reply(402, { success: false, message: 'one agent per account' }))
    await assert.rejects(api.client.createClaw({ planId: 'p', name: 'n' }), (e) => api.isOneAgentLimitRefusal(e))
    await assert.rejects(api.client.getClaws(), (e) => !api.isOneAgentLimitRefusal(e))
    await assert.rejects(api.client.startClaw('x'), (e) => !api.isOneAgentLimitRefusal(e))
})
