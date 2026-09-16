const GATEWAY_CONNECTION_STATE = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    AUTHENTICATING: 'authenticating',
    CONNECTED: 'connected'
}

class DeviceIdentity {
    constructor(deviceId, publicKeyBase64, keyPair) {
        this.deviceId = deviceId
        this.publicKeyBase64 = publicKeyBase64
        this.keyPair = keyPair
    }

    async sign(payload) {
        const encoder = new TextEncoder()
        const data = encoder.encode(payload)
        const signature = await crypto.subtle.sign(
            { name: 'Ed25519' },
            this.keyPair.privateKey,
            data
        )
        return btoa(String.fromCharCode(...new Uint8Array(signature)))
    }
}

class DeviceIdentityService {
    static _cached = null

    static async getOrCreate() {
        if (this._cached) return this._cached

        const stored = await chrome.storage.local.get(['device_ed25519_private', 'device_ed25519_public', 'device_id'])

        if (stored.device_ed25519_private && stored.device_ed25519_public && stored.device_id) {
            try {
                const privateKeyData = Uint8Array.from(atob(stored.device_ed25519_private), c => c.charCodeAt(0))
                const publicKeyData = Uint8Array.from(atob(stored.device_ed25519_public), c => c.charCodeAt(0))

                const keyPair = {
                    privateKey: await crypto.subtle.importKey(
                        'pkcs8', privateKeyData, { name: 'Ed25519' }, false, ['sign']
                    ),
                    publicKey: await crypto.subtle.importKey(
                        'spki', publicKeyData, { name: 'Ed25519' }, true, ['verify']
                    )
                }

                this._cached = new DeviceIdentity(stored.device_id, stored.device_ed25519_public, keyPair)
                return this._cached
            } catch (e) {
                console.error('Failed to load stored keys, generating new ones:', e)
            }
        }

        const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])

        const privateKeyExport = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
        const publicKeyExport = await crypto.subtle.exportKey('spki', keyPair.publicKey)
        const rawPublicKey = await crypto.subtle.exportKey('raw', keyPair.publicKey)

        const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(privateKeyExport)))
        const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyExport)))

        const hashBuffer = await crypto.subtle.digest('SHA-256', rawPublicKey)
        const deviceId = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

        const reimportedKeyPair = {
            privateKey: await crypto.subtle.importKey(
                'pkcs8', privateKeyExport, { name: 'Ed25519' }, false, ['sign']
            ),
            publicKey: keyPair.publicKey
        }

        await chrome.storage.local.set({
            device_ed25519_private: privateKeyBase64,
            device_ed25519_public: publicKeyBase64,
            device_id: deviceId
        })

        this._cached = new DeviceIdentity(deviceId, publicKeyBase64, reimportedKeyPair)
        return this._cached
    }
}

function parseMessageContent(message) {
    if (message == null) return { text: '', images: [] }
    if (typeof message === 'string') return { text: message, images: [] }

    if (typeof message === 'object' && !Array.isArray(message)) {
        if (message.content != null) return parseMessageContent(message.content)
        if (typeof message.text === 'string') return { text: message.text, images: [] }
        return { text: '', images: [] }
    }

    if (Array.isArray(message)) {
        let text = ''
        const images = []

        for (const block of message) {
            if (typeof block === 'string') {
                text += block
                continue
            }
            if (typeof block === 'object' && block !== null) {
                const type = block.type
                if (type === 'text') {
                    text += block.text || ''
                } else if (type === 'image') {
                    const mimeType = block.mimeType || block.media_type || block.mediaType || 'image/png'
                    let imageData = null

                    const source = block.source
                    if (source) {
                        imageData = source.data
                        if (imageData) {
                            images.push({ mimeType: source.media_type || source.mediaType || mimeType, base64Data: imageData })
                        }
                        if (!imageData && source.url) {
                            text += `\n\n![image](${source.url})\n\n`
                        }
                    }

                    if (!imageData && block.data) {
                        imageData = block.data
                        images.push({ mimeType, base64Data: imageData })
                    }

                    if (!imageData && block.bytes && !block.omitted) {
                        images.push({ mimeType, base64Data: block.bytes })
                    }

                    if (!imageData && block.url) {
                        text += `\n\n![image](${block.url})\n\n`
                    }
                }
            }
        }

        return { text, images }
    }

    return { text: '', images: [] }
}

function normalizeOutgoingAttachment(attachment) {
    if (!attachment || typeof attachment !== 'object') return null

    const type = attachment.type || 'image'

    if (typeof attachment.mimeType === 'string' && typeof attachment.content === 'string') {
        return {
            type,
            mimeType: attachment.mimeType,
            content: attachment.content
        }
    }

    const source = attachment.source
    if (source && typeof source === 'object' && typeof source.data === 'string') {
        return {
            type,
            mimeType: source.mediaType || source.mimeType || attachment.mimeType || 'image/png',
            content: source.data
        }
    }

    return null
}

class ChatService {
    constructor(gatewayUrl, gatewayToken) {
        this.gatewayUrl = gatewayUrl
        this.gatewayToken = gatewayToken || ''
        this._ws = null
        this._state = GATEWAY_CONNECTION_STATE.DISCONNECTED
        this._reqCounter = 0
        this._pendingRequests = {}
        this._eventListeners = {}
        this._connectResolve = null
        this._connectReject = null
    }

    get isConnected() {
        return this._state === GATEWAY_CONNECTION_STATE.CONNECTED
    }

    async connect() {
        if (this._state === GATEWAY_CONNECTION_STATE.CONNECTED) return true
        if (this._state === GATEWAY_CONNECTION_STATE.CONNECTING || this._state === GATEWAY_CONNECTION_STATE.AUTHENTICATING) {
            return new Promise((resolve) => {
                const check = setInterval(() => {
                    if (this._state === GATEWAY_CONNECTION_STATE.CONNECTED) {
                        clearInterval(check)
                        resolve(true)
                    } else if (this._state === GATEWAY_CONNECTION_STATE.DISCONNECTED) {
                        clearInterval(check)
                        resolve(false)
                    }
                }, 200)
            })
        }

        this._state = GATEWAY_CONNECTION_STATE.CONNECTING

        return new Promise((resolve) => {
            let wsUrl = this.gatewayUrl
                .replace('https://', 'wss://')
                .replace('http://', 'ws://')
            if (!wsUrl.endsWith('/')) wsUrl += '/'

            console.log('[ChatService] Connecting to', wsUrl)
            this._connectResolve = resolve

            try {
                this._ws = new WebSocket(wsUrl)
            } catch (e) {
                console.error('[ChatService] WebSocket creation failed:', e)
                this._handleDisconnect()
                resolve(false)
                return
            }

            const timeout = setTimeout(() => {
                if (this._state !== GATEWAY_CONNECTION_STATE.CONNECTED) {
                    console.error('[ChatService] Connection timeout')
                    this._handleDisconnect()
                    resolve(false)
                }
            }, 15000)

            this._ws.onopen = () => {
                console.log('[ChatService] WebSocket open, waiting for challenge...')
            }

            this._ws.onmessage = (event) => {
                this._onMessage(event.data, timeout)
            }

            this._ws.onerror = (e) => {
                console.error('[ChatService] WebSocket error:', e.type, 'url:', wsUrl)
                clearTimeout(timeout)
                this._handleDisconnect()
                resolve(false)
            }

            this._ws.onclose = (e) => {
                console.log('[ChatService] WebSocket closed, code:', e.code, 'reason:', e.reason, 'wasClean:', e.wasClean)
                clearTimeout(timeout)
                this._handleDisconnect()
            }
        })
    }

    disconnect() {
        if (this._ws) {
            this._ws.close()
            this._ws = null
        }
        this._state = GATEWAY_CONNECTION_STATE.DISCONNECTED
        this._pendingRequests = {}
        this._eventListeners = {}
    }

    async sendChatMessage({ message, sessionKey, attachments = [], onDelta, onComplete, onError }) {
        if (!this.isConnected) {
            const ok = await this.connect()
            if (!ok) {
                onError(I18n.t('sys.gatewayFailed'))
                return
            }
        }

        const idempotencyKey = crypto.randomUUID()
        let resolve
        const completePromise = new Promise(r => { resolve = r })

        let activeRunId = null
        let lastContent = { text: '', images: [] }

        const chatListener = (payload) => {
            const eventSessionKey = payload.sessionKey
            if (eventSessionKey !== sessionKey) return

            const state = payload.state
            const runId = payload.runId

            if (!activeRunId) activeRunId = runId
            if (runId && runId !== activeRunId) return

            switch (state) {
                case 'delta': {
                    const parsed = parseMessageContent(payload.message)
                    if (parsed.text || parsed.images.length > 0) {
                        lastContent = parsed
                        onDelta(parsed)
                    }
                    break
                }
                case 'final': {
                    const parsed = parseMessageContent(payload.message)
                    if (parsed.text || parsed.images.length > 0) {
                        lastContent = parsed
                    }
                    onComplete(lastContent)
                    this._removeEventListener('chat', chatListener)
                    resolve()
                    break
                }
                case 'error': {
                    const errorMsg = payload.errorMessage || 'Unknown error'
                    onError(errorMsg)
                    this._removeEventListener('chat', chatListener)
                    resolve()
                    break
                }
                case 'aborted': {
                    onComplete(lastContent)
                    this._removeEventListener('chat', chatListener)
                    resolve()
                    break
                }
            }
        }

        this._addEventListener('chat', chatListener)

        try {
            const requestPayload = {
                sessionKey,
                message,
                deliver: true,
                timeoutMs: 120000,
                idempotencyKey
            }

            const normalizedAttachments = Array.isArray(attachments)
                ? attachments.map(normalizeOutgoingAttachment).filter(Boolean)
                : []

            if (normalizedAttachments.length > 0) {
                requestPayload.attachments = normalizedAttachments
                const totalBytes = normalizedAttachments.reduce((sum, a) => sum + (a.content ? a.content.length : 0), 0)
                console.info(`[ChatService][附件诊断] 发送 ${normalizedAttachments.length} 个附件, 类型: ${normalizedAttachments.map(a => a.mimeType).join(', ')}, base64总长: ${totalBytes} 字符 (~${Math.round(totalBytes * 0.75 / 1024)}KB)`)
            } else {
                console.info('[ChatService][附件诊断] 本次发送无附件')
            }

            const response = await this._sendRequest('chat.send', requestPayload)

            if (response.ok !== true) {
                console.warn('[ChatService] chat.send rejected, waiting for events anyway')
            }

            const timeout = setTimeout(() => {
                onComplete(lastContent)
                this._removeEventListener('chat', chatListener)
                resolve()
            }, 120000)

            await completePromise
            clearTimeout(timeout)
        } catch (e) {
            console.error('[ChatService] chat.send error:', e)
            this._removeEventListener('chat', chatListener)
            onError(I18n.t('sys.sendFailed', { msg: e.message }))
        }
    }

    async abortChat(sessionKey, runId) {
        if (!this.isConnected) return
        try {
            await this._sendRequest('chat.abort', { sessionKey, runId })
        } catch (e) {
            console.error('[ChatService] abort error:', e)
        }
    }

    async resolveSessionKey(agentId) {
        const defaultKey = `agent:${agentId}:main`
        if (!this.isConnected) return defaultKey

        try {
            const response = await this._sendRequest('sessions.list', {})
            if (response.ok === true) {
                const payload = response.payload
                let sessions = null
                if (Array.isArray(payload)) {
                    sessions = payload
                } else if (payload && Array.isArray(payload.sessions)) {
                    sessions = payload.sessions
                }

                if (sessions) {
                    const prefix = `agent:${agentId}:`
                    for (const s of sessions) {
                        if (s && typeof s === 'object') {
                            const key = s.key || s.sessionKey
                            if (key && key.startsWith(prefix)) {
                                return key
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[ChatService] resolveSessionKey error:', e)
        }

        return defaultKey
    }

    _addEventListener(event, listener) {
        if (!this._eventListeners[event]) this._eventListeners[event] = []
        this._eventListeners[event].push(listener)
    }

    _removeEventListener(event, listener) {
        if (this._eventListeners[event]) {
            this._eventListeners[event] = this._eventListeners[event].filter(l => l !== listener)
        }
    }

    _onMessage(raw, connectTimeout) {
        try {
            const data = JSON.parse(raw)
            const type = data.type

            switch (type) {
                case 'event':
                    this._handleEvent(data, connectTimeout)
                    break
                case 'res':
                    this._handleResponse(data, connectTimeout)
                    break
            }
        } catch (e) {
            console.error('[ChatService] Parse error:', e)
        }
    }

    _handleEvent(data, connectTimeout) {
        const event = data.event
        const payload = data.payload || {}

        if (event === 'connect.challenge') {
            const nonce = payload.nonce || ''
            this._state = GATEWAY_CONNECTION_STATE.AUTHENTICATING
            this._authenticateWithDevice(nonce)
            return
        }

        const listeners = this._eventListeners[event]
        if (listeners) {
            for (const listener of [...listeners]) {
                listener(payload)
            }
        }
    }

    _handleResponse(data, connectTimeout) {
        const id = data.id
        const ok = data.ok || false

        if (ok && this._state === GATEWAY_CONNECTION_STATE.AUTHENTICATING) {
            const payload = data.payload
            if (payload && payload.type === 'hello-ok') {
                this._state = GATEWAY_CONNECTION_STATE.CONNECTED
                if (connectTimeout) clearTimeout(connectTimeout)
                if (this._connectResolve) {
                    this._connectResolve(true)
                    this._connectResolve = null
                }
            }
        }

        if (id && this._pendingRequests[id]) {
            this._pendingRequests[id].resolve(data)
            delete this._pendingRequests[id]
        }
    }

    async _authenticateWithDevice(nonce) {
        try {
            const device = await DeviceIdentityService.getOrCreate()
            const now = Date.now()
            const clientId = 'openclaw-control-ui'
            const clientMode = 'webchat'
            const role = 'operator'
            const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing']

            const signPayload = [
                'v2', device.deviceId, clientId, clientMode, role,
                scopes.join(','), now.toString(), this.gatewayToken, nonce
            ].join('|')

            const signature = await device.sign(signPayload)
            const id = this._nextReqId()

            const frame = {
                type: 'req',
                id,
                method: 'connect',
                params: {
                    minProtocol: 3,
                    maxProtocol: 3,
                    client: {
                        id: clientId,
                        version: 'control-ui',
                        platform: 'chrome-extension',
                        mode: clientMode,
                        instanceId: crypto.randomUUID()
                    },
                    role,
                    scopes,
                    device: {
                        id: device.deviceId,
                        publicKey: device.publicKeyBase64,
                        signature,
                        signedAt: now,
                        nonce
                    },
                    caps: ['tool-events'],
                    auth: {
                        token: this.gatewayToken
                    }
                }
            }

            const pending = {}
            pending.promise = new Promise((resolve, reject) => {
                pending.resolve = resolve
                pending.reject = reject
            })
            this._pendingRequests[id] = pending
            this._send(frame)
        } catch (e) {
            console.error('[ChatService] Device auth failed:', e)
            this._handleDisconnect()
        }
    }

    async _sendRequest(method, params) {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected')
        }

        const id = this._nextReqId()
        const frame = {
            type: 'req',
            id,
            method,
            params
        }

        const pending = {}
        pending.promise = new Promise((resolve, reject) => {
            pending.resolve = resolve
            pending.reject = reject
        })
        this._pendingRequests[id] = pending
        this._send(frame)

        const timeoutMs = method === 'chat.send' ? 120000 : 15000
        return Promise.race([
            pending.promise,
            new Promise((_, reject) =>
                setTimeout(() => {
                    delete this._pendingRequests[id]
                    reject(new Error(`Request timeout: ${method}`))
                }, timeoutMs)
            )
        ])
    }

    _send(frame) {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify(frame))
        }
    }

    _nextReqId() {
        this._reqCounter++
        return `req-${this._reqCounter}`
    }

    _handleDisconnect() {
        this._state = GATEWAY_CONNECTION_STATE.DISCONNECTED
        if (this._ws) {
            this._ws.close()
            this._ws = null
        }

        for (const id in this._pendingRequests) {
            if (this._pendingRequests[id].reject) {
                this._pendingRequests[id].reject(new Error('Connection lost'))
            }
        }
        this._pendingRequests = {}

        if (this._connectResolve) {
            this._connectResolve(false)
            this._connectResolve = null
        }
    }
}

class ChatManager {
    constructor() {
        this.sessions = {}
        this.activeClaw = null
        this.service = null
        this.sessionKey = null
    }

    getSession(clawId) {
        if (!this.sessions[clawId]) {
            this.sessions[clawId] = {
                clawId,
                clawName: '',
                messages: [],
                isGenerating: false
            }
        }
        return this.sessions[clawId]
    }

    async openChat(claw) {
        this.activeClaw = claw
        const session = this.getSession(claw.id)
        session.clawName = claw.name || 'OpenClaw'

        if (this.service) {
            this.service.disconnect()
            this.service = null
            this.sessionKey = null
        }

        renderChatUI(session)
    }

    async sendMessage(text) {
        if (!this.activeClaw || !text.trim()) return

        const claw = this.activeClaw
        const session = this.getSession(claw.id)

        if (session.isGenerating) return

        const userMsg = {
            id: crypto.randomUUID(),
            role: 'user',
            content: text.trim(),
            images: [],
            timestamp: Date.now(),
            isStreaming: false,
            isError: false
        }

        const assistantMsg = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '',
            images: [],
            timestamp: Date.now(),
            isStreaming: true,
            isError: false
        }

        session.messages.push(userMsg, assistantMsg)
        session.isGenerating = true
        renderChatUI(session)
        scrollChatToBottom()

        const gatewayUrl = claw.subdomain ? `https://${claw.subdomain}.digitalenginecore.com` : null
        if (!gatewayUrl) {
            this._updateLastAssistant(session, '网关地址不可用', false, true)
            return
        }

        if (!this.service) {
            this.service = new ChatService(gatewayUrl, claw.gatewayToken || '')
        }

        if (!this.service.isConnected) {
            const ok = await this.service.connect()
            if (!ok) {
                this._updateLastAssistant(session, I18n.t('sys.gatewayFailed'), false, true)
                return
            }
            this.sessionKey = await this.service.resolveSessionKey('main')
        }

        const sessionKey = this.sessionKey || 'agent:main:main'

        try {
            await this.service.sendChatMessage({
                message: text.trim(),
                sessionKey,
                onDelta: (parsed) => {
                    this._updateLastAssistant(session, parsed.text, true, false, parsed.images)
                    scrollChatToBottom()
                },
                onComplete: (parsed) => {
                    const content = parsed.text || I18n.t('sys.noReply')
                    const isError = !parsed.text && parsed.images.length === 0
                    this._updateLastAssistant(session, content, false, isError, parsed.images)
                },
                onError: (error) => {
                    this._updateLastAssistant(session, error, false, true)
                }
            })
        } catch (e) {
            console.error('[ChatManager] sendMessage error:', e)
            this._updateLastAssistant(session, I18n.t('sys.connectError', { msg: e.message }), false, true)
        }
    }

    stopGenerating() {
        if (!this.activeClaw) return
        const session = this.getSession(this.activeClaw.id)

        if (this.service && this.sessionKey) {
            this.service.abortChat(this.sessionKey, '')
        }

        const msgs = session.messages
        if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
            msgs[msgs.length - 1].isStreaming = false
        }
        session.isGenerating = false
        renderChatUI(session)
    }

    newSession() {
        if (!this.activeClaw) return
        const session = this.getSession(this.activeClaw.id)
        session.messages = []
        session.isGenerating = false

        if (this.service) {
            this.service.disconnect()
            this.service = null
            this.sessionKey = null
        }

        renderChatUI(session)
    }

    closeChat() {
        if (this.service) {
            this.service.disconnect()
            this.service = null
            this.sessionKey = null
        }
        this.activeClaw = null
    }

    _updateLastAssistant(session, content, isStreaming, isError = false, images = null) {
        const msgs = session.messages
        if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
            msgs[msgs.length - 1].content = content
            msgs[msgs.length - 1].isStreaming = isStreaming
            msgs[msgs.length - 1].isError = isError
            if (images) msgs[msgs.length - 1].images = images
        }
        session.isGenerating = isStreaming
        renderChatUI(session)
    }
}

const chatManager = new ChatManager()

function renderChatUI(session) {
    const container = document.getElementById('chat-messages')
    const emptyState = document.getElementById('chat-empty')
    const noClaw = document.getElementById('chat-no-claw')
    const inputBar = document.getElementById('chat-input-bar')
    const headerName = document.getElementById('chat-claw-name')
    const sendBtn = document.getElementById('btn-chat-send')

    if (noClaw) noClaw.classList.add('hidden')

    if (headerName) {
        headerName.textContent = session.clawName || 'Chat'
    }

    if (session.messages.length === 0) {
        container.innerHTML = ''
        emptyState.classList.remove('hidden')
    } else {
        emptyState.classList.add('hidden')
        container.innerHTML = session.messages.map(msg => renderChatBubble(msg)).join('')
    }

    if (sendBtn) {
        const input = document.getElementById('chat-input')
        const hasText = input && input.value.trim().length > 0
        if (session.isGenerating) {
            sendBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 256 256"><path d="M200,32H56A24,24,0,0,0,32,56V200a24,24,0,0,0,24,24H200a24,24,0,0,0,24-24V56A24,24,0,0,0,200,32Z"/></svg>'
            sendBtn.classList.add('stop')
            sendBtn.classList.toggle('active', true)
        } else {
            sendBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 256 256"><path d="M236.2,218.31A8,8,0,0,1,228,224H128a108,108,0,0,1,0-216h4a8,8,0,0,1,0,16h-4a92,92,0,0,0,0,184h92.69l-18.35-18.34a8,8,0,0,1,11.32-11.32l32,32a8,8,0,0,1,0,11.32Z"/></svg>'
            sendBtn.classList.remove('stop')
            sendBtn.classList.toggle('active', hasText)
        }
    }
}

function renderChatBubble(msg) {
    const isUser = msg.role === 'user'

    if (isUser) {
        return `<div class="chat-bubble chat-bubble-user"><div class="chat-bubble-content user">${escapeHtml(msg.content)}</div></div>`
    }

    if (msg.isError) {
        return `<div class="chat-bubble chat-bubble-assistant"><div class="chat-bubble-content error"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM120,104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm8,88a12,12,0,1,1,12-12A12,12,0,0,1,128,192Z"/></svg><span>${escapeHtml(msg.content)}</span></div></div>`
    }

    if (!msg.content && msg.isStreaming) {
        return `<div class="chat-bubble chat-bubble-assistant"><div class="chat-typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`
    }

    let html = '<div class="chat-bubble chat-bubble-assistant">'

    if (msg.images && msg.images.length > 0) {
        for (const img of msg.images) {
            html += `<img class="chat-image" src="data:${escapeHtml(img.mimeType)};base64,${img.base64Data}" alt="image">`
        }
    }

    if (msg.content) {
        const rendered = renderMarkdown(msg.content)
        const shimmer = msg.isStreaming ? ' streaming' : ''
        html += `<div class="chat-bubble-content assistant${shimmer}">${rendered}</div>`
    }

    if (!msg.isStreaming && msg.content) {
        html += `<div class="chat-msg-actions"><button class="chat-msg-action-btn" onclick="chatCopyMessage(this)" title="复制"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg></button></div>`
    }

    html += '</div>'
    return html
}

function chatCopyMessage(btn) {
    const bubble = btn.closest('.chat-bubble')
    const content = bubble.querySelector('.chat-bubble-content.assistant')
    if (!content) return
    navigator.clipboard.writeText(content.textContent).then(() => {
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>'
        btn.classList.add('copied')
        setTimeout(() => {
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg>'
            btn.classList.remove('copied')
        }, 2000)
    })
}

function renderMarkdown(text) {
    text = text.replace(/IMG_PLACEHOLDER_\d+/g, '')

    const codeBlocks = []
    let processed = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const idx = codeBlocks.length
        codeBlocks.push({ lang, code })
        return `\x00CODEBLOCK_${idx}\x00`
    })

    const inlineCodes = []
    processed = processed.replace(/`([^`]+)`/g, (_, code) => {
        const idx = inlineCodes.length
        inlineCodes.push(code)
        return `\x00INLINE_${idx}\x00`
    })

    let html = escapeHtml(processed)

    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')

    html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="chat-blockquote">$1</blockquote>')

    html = html.replace(/^### (.+)$/gm, '<h4 class="chat-md-heading">$1</h4>')
    html = html.replace(/^## (.+)$/gm, '<h3 class="chat-md-heading">$1</h3>')
    html = html.replace(/^# (.+)$/gm, '<h2 class="chat-md-heading">$1</h2>')

    html = html.replace(/^---$/gm, '<hr class="chat-md-hr">')

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

    html = html.replace(/(^|\n)((?:- .+(?:\n|$))+)/g, (_, before, block) => {
        const items = block.trim().split('\n').map(l => `<li>${l.replace(/^- /, '')}</li>`).join('')
        return `${before}<ul class="chat-md-list">${items}</ul>`
    })

    html = html.replace(/(^|\n)((?:\d+\. .+(?:\n|$))+)/g, (_, before, block) => {
        const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('')
        return `${before}<ol class="chat-md-list">${items}</ol>`
    })

    codeBlocks.forEach((block, idx) => {
        const langLabel = block.lang ? `<span class="chat-code-lang">${escapeHtml(block.lang)}</span>` : ''
        const copyBtn = `<button class="chat-code-copy-btn" onclick="chatCopyCode(this)" title="复制"><svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg></button>`
        const replacement = `<div class="chat-code-wrapper"><div class="chat-code-header">${langLabel}${copyBtn}</div><pre class="chat-code-block"><code>${escapeHtml(block.code)}</code></pre></div>`
        html = html.replace(`\x00CODEBLOCK_${idx}\x00`, replacement)
    })

    inlineCodes.forEach((code, idx) => {
        html = html.replace(`\x00INLINE_${idx}\x00`, `<code class="chat-inline-code">${escapeHtml(code)}</code>`)
    })

    html = html.replace(/\n\n/g, '</p><p>')
    html = html.replace(/\n/g, '<br>')

    return html
}

function chatCopyCode(btn) {
    const wrapper = btn.closest('.chat-code-wrapper')
    const code = wrapper.querySelector('code').textContent
    navigator.clipboard.writeText(code).then(() => {
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>'
        btn.classList.add('copied')
        setTimeout(() => {
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg>'
            btn.classList.remove('copied')
        }, 2000)
    })
}

function scrollChatToBottom() {
    const container = document.getElementById('chat-messages')
    if (container) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight
        })
    }
}

function openClawChat(clawId) {
    const claw = clawsList.find(c => c.id === clawId)
    if (!claw) {
        showToast(I18n.t('sys.clawNotFound'), 'error')
        return
    }
    chatManager.openChat(claw)
    switchTab('chat')
}

function setupChatEventListeners() {
    const input = document.getElementById('chat-input')
    const sendBtn = document.getElementById('btn-chat-send')
    const newSessionBtn = document.getElementById('btn-chat-new')
    const backBtn = document.getElementById('btn-chat-back')

    let isChatComposing = false
    if (input) {
        input.addEventListener('compositionstart', () => { isChatComposing = true })
        input.addEventListener('compositionend', () => { isChatComposing = false })
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !isChatComposing && !e.isComposing) {
                e.preventDefault()
                handleChatSend()
            }
        })
        input.addEventListener('input', () => {
            const session = chatManager.activeClaw ? chatManager.getSession(chatManager.activeClaw.id) : null
            if (sendBtn && !session?.isGenerating) {
                sendBtn.classList.toggle('active', input.value.trim().length > 0)
            }
            input.style.height = 'auto'
            input.style.height = Math.min(input.scrollHeight, 120) + 'px'
        })
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', handleChatSend)
    }

    if (newSessionBtn) {
        newSessionBtn.addEventListener('click', () => {
            chatManager.newSession()
        })
    }

    if (backBtn) {
        backBtn.addEventListener('click', () => {
            chatManager.closeChat()
            switchTab('claws')
        })
    }
}

function handleChatSend() {
    const input = document.getElementById('chat-input')
    if (!input) return

    const session = chatManager.activeClaw ? chatManager.getSession(chatManager.activeClaw.id) : null

    if (session && session.isGenerating) {
        chatManager.stopGenerating()
        return
    }

    const text = input.value
    if (!text.trim()) return

    input.value = ''
    input.style.height = 'auto'
    chatManager.sendMessage(text)
}