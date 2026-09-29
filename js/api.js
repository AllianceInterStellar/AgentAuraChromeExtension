const DEFAULT_API_BASE_URL = 'https://awsapi.allianceinterstellar.com'
let API_BASE_URL = DEFAULT_API_BASE_URL

// The dev override is read asynchronously; requests wait for it so the first one does not go
// to the default host while the override is still loading.
const apiBaseReady = (async () => {
    try {
        const result = await chrome.storage.local.get('dev_api_url')
        if (result.dev_api_url) API_BASE_URL = result.dev_api_url
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.dev_api_url) {
                API_BASE_URL = changes.dev_api_url.newValue || DEFAULT_API_BASE_URL
            }
        })
    } catch (_) { }
})()

/**
 * A failed request. `status` is the HTTP status (0 for a network failure), `code` a stable
 * name callers can switch on without reading the message.
 */
class ApiError extends Error {
    constructor(message, { status = 0, method = '', path = '', code = null } = {}) {
        super(message)
        this.name = 'ApiError'
        this.status = status
        this.method = method
        this.path = path
        this.code = code || (status === 401 ? 'UNAUTHORIZED' : status === 0 ? 'NETWORK' : `HTTP_${status}`)
    }
}

class ApiClient {
    constructor() {
        this.authToken = null
        /**
         * Set by AuthService: asked to produce a fresh token when a request comes back 401.
         * Returns the new token, or null when the session really is over.
         */
        this.onUnauthorized = null
        this.timeoutMs = 30000
    }

    setAuthToken(token) {
        this.authToken = token
    }

    getBaseUrl() {
        return API_BASE_URL
    }

    async _request(method, path, data = null, { retryOn401 = true } = {}) {
        await apiBaseReady

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`
        }

        const options = { method, headers }
        if (data) {
            options.body = JSON.stringify(data)
        }

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
        const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null
        if (controller) options.signal = controller.signal

        let response
        try {
            response = await fetch(`${API_BASE_URL}${path}`, options)
        } catch (e) {
            const timedOut = e && e.name === 'AbortError'
            throw new ApiError(timedOut ? 'Request timed out' : (e.message || 'Network error'), {
                status: 0, method, path, code: timedOut ? 'TIMEOUT' : 'NETWORK'
            })
        } finally {
            if (timer) clearTimeout(timer)
        }

        if (response.status === 401 && retryOn401 && this.onUnauthorized) {
            let fresh = null
            try {
                fresh = await this.onUnauthorized()
            } catch (_) { }
            if (fresh) {
                this.authToken = fresh
                return this._request(method, path, data, { retryOn401: false })
            }
        }

        if (!response.ok) {
            let errorMessage = `API Error: ${response.status} ${response.statusText}`
            try {
                const errorData = await response.json()
                if (errorData.error) errorMessage = errorData.error
                else if (errorData.message) errorMessage = errorData.message
            } catch { }
            // Callers that need to tell one refusal from another read the status and the
            // request it answered, not the message text, which the server may reword.
            throw new ApiError(errorMessage, { status: response.status, method, path })
        }
        if (response.status === 204) return null
        return response.json()
    }

    /**
     * Read methods throw on failure. They used to return `[]`/`null`, which made a 401, a dead
     * network and "you have no instances" look identical to every caller.
     */
    async getClaws() {
        const result = await this._request('GET', '/claws')
        const data = result?.data
        if (Array.isArray(data)) return data
        return result?.claws || []
    }

    async getClaw(id) {
        return await this._request('GET', `/claws/${encodeURIComponent(id)}`)
    }

    async createClaw({ planId, name, location, provider, deploymentMethod, providerToken, aiProvider, aiModel, aiEnvVar }) {
        const data = { planId, name }
        if (location) data.location = location
        if (provider) data.provider = provider
        if (deploymentMethod) data.deploymentMethod = deploymentMethod
        if (providerToken) data.providerToken = providerToken
        if (aiProvider) data.aiProvider = aiProvider
        if (aiModel) data.aiModel = aiModel
        if (aiEnvVar) data.aiEnvVar = aiEnvVar
        return await this._request('POST', '/claws', data)
    }

    /**
     * Mutations throw as well, so the UI can say what went wrong instead of toasting success.
     * A forced delete is a separate, explicit call: it used to be tried automatically whenever
     * the ordinary delete failed for any reason.
     */
    async deleteClaw(id, { force = false } = {}) {
        const suffix = force ? '/force' : ''
        await this._request('DELETE', `/claws/${encodeURIComponent(id)}${suffix}`)
        return true
    }

    async startClaw(id) {
        await this._request('POST', `/claws/${encodeURIComponent(id)}/start`)
        return true
    }

    async stopClaw(id) {
        await this._request('POST', `/claws/${encodeURIComponent(id)}/stop`)
        return true
    }

    async restartClaw(id) {
        await this._request('POST', `/claws/${encodeURIComponent(id)}/restart`)
        return true
    }

    async getCurrentUser() {
        return await this._request('GET', '/users/me')
    }

    async getProvisionProgress(id) {
        const result = await this._request('POST', `/claws/${encodeURIComponent(id)}/provision-progress`)
        if (result && result.data) return result.data
        return result
    }

    async getProviderPlans(provider) {
        const result = await this._request('GET', `/plans?provider=${encodeURIComponent(provider)}`)
        return result?.data || null
    }

    async getProviderRegions(provider) {
        const result = await this._request('GET', `/plans/locations?provider=${encodeURIComponent(provider)}`)
        return Array.isArray(result?.data) ? result.data : []
    }

    async syncProviderConfig(provider, config) {
        return await this._request('PUT', '/provider-configs', {
            provider,
            tokens: config
        })
    }

    async updateClawAgentConfig(clawId, { agentId, model, envVars }) {
        const data = { agentId: agentId || 'main' }
        if (model) data.model = model
        if (envVars && Object.keys(envVars).length > 0) data.envVars = envVars
        await this._request('PUT', `/claws/${encodeURIComponent(clawId)}/agent-config`, data)
        return true
    }

    async getCloudStorageConfigs() {
        const result = await this._request('GET', '/cloud-storage')
        if (result && Array.isArray(result.data)) return result.data
        return []
    }

    async upsertCloudStorageConfig(data) {
        return await this._request('PUT', '/cloud-storage', data)
    }

    async deleteCloudStorageConfig(id) {
        await this._request('DELETE', `/cloud-storage/${encodeURIComponent(id)}`)
        return true
    }

    async mountClawStorage(clawId, storageConfigId) {
        return await this._request('POST', `/claws/${encodeURIComponent(clawId)}/mount`, { storageConfigId })
    }

    async unmountClawStorage(clawId) {
        return await this._request('DELETE', `/claws/${encodeURIComponent(clawId)}/mount`)
    }

    async triggerCloudSync(clawId, storageConfigId) {
        // Backend triggerSync requires the claw to run the sync on plus the storage config.
        return await this._request('POST', '/cloud-storage/sync', { clawId, storageConfigId })
    }

    async installAgentSkill(clawId, agentId, skillName, content = null) {
        const body = { action: 'install', skillName }
        if (content) body.content = content
        try {
            await this._request('PUT', `/claws/${encodeURIComponent(clawId)}/agents/${encodeURIComponent(agentId)}/skills`, body)
            return true
        } catch (e) {
            console.error('Error installing agent skill:', e)
            return false
        }
    }

    async writeClawFile(clawId, filePath, content) {
        await this._request('PUT', `/claws/${encodeURIComponent(clawId)}/files`, {
            path: filePath,
            content
        })
        return true
    }

    async readClawFile(clawId, filePath) {
        try {
            const result = await this._request('POST', `/claws/${encodeURIComponent(clawId)}/files/read`, {
                path: filePath
            })
            return result?.data?.content || result?.content || null
        } catch (e) {
            console.error('Error reading claw file:', e)
            return null
        }
    }
}

/**
 * Whether a failed request is the server refusing to create another agent because the account
 * already runs the one this version allows. POST /claws answers that with 402 and uses 402 for
 * nothing else; every other refusal of that call (identity not verified, a deployment already
 * running, the account cap, a provider error) has its own status and keeps its own message.
 */
function isOneAgentLimitRefusal(error) {
    return error?.status === 402 && error.method === 'POST' && error.path === '/claws'
}

/** A 401 that survived the refresh attempt: the user has to sign in again. */
function isAuthExpired(error) {
    return error?.status === 401
}

const apiClient = new ApiClient()

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ApiClient, ApiError, isOneAgentLimitRefusal, isAuthExpired }
}
