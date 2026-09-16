const DEFAULT_API_BASE_URL = 'https://d1em8r2hdbckr6.cloudfront.net'
let API_BASE_URL = DEFAULT_API_BASE_URL

try {
    chrome.storage.local.get('dev_api_url', (result) => {
        if (result.dev_api_url) API_BASE_URL = result.dev_api_url
    })
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.dev_api_url) {
            API_BASE_URL = changes.dev_api_url.newValue || DEFAULT_API_BASE_URL
        }
    })
} catch (_) { }

class ApiClient {
    constructor() {
        this.authToken = null
    }

    setAuthToken(token) {
        this.authToken = token
    }

    getBaseUrl() {
        return API_BASE_URL
    }

    async _request(method, path, data = null) {
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

        const response = await fetch(`${API_BASE_URL}${path}`, options)
        if (!response.ok) {
            let errorMessage = `API Error: ${response.status} ${response.statusText}`
            try {
                const errorData = await response.json()
                if (errorData.error) errorMessage = errorData.error
                else if (errorData.message) errorMessage = errorData.message
            } catch { }
            throw new Error(errorMessage)
        }
        return response.json()
    }

    async getClaws() {
        try {
            const result = await this._request('GET', '/claws')
            const data = result.data
            if (Array.isArray(data)) return data
            return result.claws || []
        } catch (e) {
            console.error('Error fetching claws:', e)
            return []
        }
    }

    async getClaw(id) {
        try {
            return await this._request('GET', `/claws/${encodeURIComponent(id)}`)
        } catch (e) {
            console.error('Error fetching claw:', e)
            return null
        }
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

    async deleteClaw(id) {
        try {
            await this._request('DELETE', `/claws/${encodeURIComponent(id)}`)
            return true
        } catch (e) {
            console.error('Error deleting claw:', e)
            try {
                await this._request('DELETE', `/claws/${encodeURIComponent(id)}/force`)
                return true
            } catch {
                return false
            }
        }
    }

    async startClaw(id) {
        try {
            await this._request('POST', `/claws/${encodeURIComponent(id)}/start`)
            return true
        } catch (e) {
            console.error('Error starting claw:', e)
            return false
        }
    }

    async stopClaw(id) {
        try {
            await this._request('POST', `/claws/${encodeURIComponent(id)}/stop`)
            return true
        } catch (e) {
            console.error('Error stopping claw:', e)
            return false
        }
    }

    async restartClaw(id) {
        try {
            await this._request('POST', `/claws/${encodeURIComponent(id)}/restart`)
            return true
        } catch (e) {
            console.error('Error restarting claw:', e)
            return false
        }
    }

    async getCurrentUser() {
        try {
            return await this._request('GET', '/users/me')
        } catch (e) {
            console.error('Error fetching user:', e)
            return null
        }
    }

    async getProvisionProgress(id) {
        try {
            const result = await this._request('POST', `/claws/${encodeURIComponent(id)}/provision-progress`)
            if (result && result.data) return result.data
            return result
        } catch (e) {
            console.error('Error fetching provision progress:', e)
            return null
        }
    }

    async getProviderPlans(provider) {
        try {
            const result = await this._request('GET', `/plans?provider=${encodeURIComponent(provider)}`)
            return result?.data || null
        } catch (e) {
            console.error('Error fetching provider plans:', e)
            return null
        }
    }

    async getProviderRegions(provider) {
        try {
            const result = await this._request('GET', `/plans/locations?provider=${encodeURIComponent(provider)}`)
            return Array.isArray(result?.data) ? result.data : []
        } catch (e) {
            console.error('Error fetching provider regions:', e)
            return []
        }
    }

    async getProviderConfigs() {
        try {
            const result = await this._request('GET', '/provider-configs')
            if (result && Array.isArray(result.data)) return result.data
            return null
        } catch (e) {
            console.error('Error fetching provider configs:', e)
            return null
        }
    }

    async syncProviderConfig(provider, config) {
        try {
            return await this._request('PUT', '/provider-configs', {
                provider,
                tokens: config
            })
        } catch (e) {
            console.error('Error syncing provider config:', e)
            return null
        }
    }

    async updateClawAgentConfig(clawId, { agentId, model, envVars }) {
        try {
            const data = { agentId: agentId || 'main' }
            if (model) data.model = model
            if (envVars && Object.keys(envVars).length > 0) data.envVars = envVars
            await this._request('PUT', `/claws/${encodeURIComponent(clawId)}/agent-config`, data)
            return true
        } catch (e) {
            console.error('Error updating claw agent config:', e)
            return false
        }
    }

    async createStripeCheckout({ priceAmountCents, planName, successUrl, cancelUrl }) {
        try {
            const result = await this._request('POST', '/stripe/checkout', {
                priceAmountCents,
                planName,
                platform: 'chrome-extension',
                successUrl,
                cancelUrl
            })
            if (result && result.data) return result.data
            return result
        } catch (e) {
            console.error('Error creating Stripe checkout:', e)
            return null
        }
    }

    async verifyStripeSession(sessionId) {
        try {
            const result = await this._request('POST', '/stripe/verify-session', { sessionId })
            if (result && result.data) return result.data
            return result
        } catch (e) {
            console.error('Error verifying Stripe session:', e)
            return null
        }
    }

    async getSubscriptionStatus() {
        try {
            return await this._request('GET', '/subscriptions/status')
        } catch (e) {
            console.error('Error fetching subscription status:', e)
            return null
        }
    }

    async getCloudStorageConfigs() {
        try {
            const result = await this._request('GET', '/cloud-storage')
            if (result && Array.isArray(result.data)) return result.data
            return []
        } catch (e) {
            console.error('Error fetching cloud storage configs:', e)
            return []
        }
    }

    async upsertCloudStorageConfig(data) {
        try {
            return await this._request('PUT', '/cloud-storage', data)
        } catch (e) {
            console.error('Error saving cloud storage config:', e)
            return null
        }
    }

    async deleteCloudStorageConfig(id) {
        try {
            await this._request('DELETE', `/cloud-storage/${encodeURIComponent(id)}`)
            return true
        } catch (e) {
            console.error('Error deleting cloud storage config:', e)
            return false
        }
    }

    async mountClawStorage(clawId, storageConfigId) {
        try {
            return await this._request('POST', `/claws/${encodeURIComponent(clawId)}/mount`, { storageConfigId })
        } catch (e) {
            console.error('Error mounting storage:', e)
            return null
        }
    }

    async unmountClawStorage(clawId) {
        try {
            return await this._request('DELETE', `/claws/${encodeURIComponent(clawId)}/mount`)
        } catch (e) {
            console.error('Error unmounting storage:', e)
            return null
        }
    }

    async triggerCloudSync(clawId, storageConfigId) {
        try {
            // Backend triggerSync requires the claw to run the sync on plus the storage config.
            return await this._request('POST', '/cloud-storage/sync', { clawId, storageConfigId })
        } catch (e) {
            console.error('Error triggering sync:', e)
            return null
        }
    }

    async getBackupStatus(remoteId) {
        try {
            const result = await this._request('GET', `/cloud-storage/sync/status?storageConfigId=${encodeURIComponent(remoteId)}`)
            return result?.data || null
        } catch (e) {
            console.error('Error fetching backup status:', e)
            return null
        }
    }

    async installAgentSkill(clawId, agentId, skillName, content = null) {
        try {
            const body = { action: 'install', skillName }
            if (content) body.content = content
            await this._request('PUT', `/claws/${encodeURIComponent(clawId)}/agents/${encodeURIComponent(agentId)}/skills`, body)
            return true
        } catch (e) {
            console.error('Error installing agent skill:', e)
            return false
        }
    }

    async writeClawFile(clawId, filePath, content) {
        try {
            await this._request('PUT', `/claws/${encodeURIComponent(clawId)}/files`, {
                path: filePath,
                content
            })
            return true
        } catch (e) {
            console.error('Error writing claw file:', e)
            return false
        }
    }

    async getAgentSkills(clawId, agentId) {
        try {
            const result = await this._request('POST', `/claws/${encodeURIComponent(clawId)}/agents/${encodeURIComponent(agentId)}/skills`)
            return result?.data || result?.skills || []
        } catch (e) {
            console.error('Error fetching agent skills:', e)
            return []
        }
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

const apiClient = new ApiClient()
