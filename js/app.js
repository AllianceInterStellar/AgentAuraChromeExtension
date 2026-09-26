const MORE_AGENTS_URL = 'https://allianceinterstellar.com/pricing#agentaura-plans'

const PROVIDERS = [
    { id: 'hetzner', name: 'Hetzner', icon: '🟠' },
    { id: 'vultr', name: 'Vultr', icon: '🔵' },
    { id: 'digitalocean', name: 'DigitalOcean', icon: '🐙' },
    { id: 'linode', name: 'Linode', icon: '🟢' },
    { id: 'flyio', name: 'Fly.io', icon: '✈️' },
    { id: 'railway', name: 'Railway', icon: '🚂' },
    { id: 'aws', name: 'AWS', icon: '☁️' },
    { id: 'gcp', name: 'GCP', icon: '🌐' },
    { id: 'azure', name: 'Azure', icon: '🔷' },
    { id: 'render', name: 'Render', icon: '🎨' },
    { id: 'contabo', name: 'Contabo', icon: '📦' },
    { id: 'ovhcloud', name: 'OVH', icon: '🏢' }
]

const STORAGE_TYPES = [
    {
        id: 's3', name: 'Amazon S3', icon: '☁️', visible: true, fields: [
            { key: 'accessKey', label: 'Access Key', secret: true },
            { key: 'secretKey', label: 'Secret Key', secret: true },
            { key: 'region', label: 'Region', hint: 'us-east-1' },
            { key: 'bucket', label: 'Bucket' },
            { key: 'endpoint', label: 'Endpoint (Optional)', optional: true },
            { key: 'path', label: 'Path Prefix', optional: true, hint: 'chat-history/' }
        ]
    },
    {
        id: 'gcs', name: 'Google Cloud Storage', icon: '🌐', visible: false, fields: [
            { key: 'credentials', label: 'Service Account JSON', secret: true, multiline: true },
            { key: 'bucket', label: 'Bucket' },
            { key: 'path', label: 'Path Prefix', optional: true, hint: 'chat-history/' }
        ]
    },
    {
        id: 'azure_blob', name: 'Azure Blob', icon: '🔷', visible: false, fields: [
            { key: 'account', label: 'Storage Account' },
            { key: 'key', label: 'Access Key', secret: true },
            { key: 'container', label: 'Container' },
            { key: 'path', label: 'Path Prefix', optional: true, hint: 'chat-history/' }
        ]
    },
    {
        id: 'google_drive', name: 'Google Drive', icon: '📁', visible: false, fields: [
            { key: 'clientId', label: 'Client ID' },
            { key: 'clientSecret', label: 'Client Secret', secret: true },
            { key: 'token', label: 'OAuth Token (JSON)', secret: true, multiline: true },
            { key: 'rootFolderId', label: 'Root Folder ID (Optional)', optional: true, hint: 'folder ID or "root"' }
        ]
    },
    {
        id: 'dropbox', name: 'Dropbox', icon: '📦', visible: false, fields: [
            { key: 'token', label: 'Access Token', secret: true },
            { key: 'path', label: 'Path', optional: true, hint: '/Apps/AgentAura/' }
        ]
    },
    {
        id: 'onedrive', name: 'OneDrive', icon: '☁️', visible: false, fields: [
            { key: 'token', label: 'Access Token', secret: true },
            { key: 'driveId', label: 'Drive ID (Optional)', optional: true },
            { key: 'path', label: 'Path', optional: true, hint: '/AgentAura/' }
        ]
    },
    {
        id: 'webdav', name: 'WebDAV', icon: '🌐', visible: false, fields: [
            { key: 'url', label: 'Server URL', hint: 'https://dav.example.com' },
            { key: 'user', label: 'Username' },
            { key: 'pass', label: 'Password', secret: true },
            { key: 'path', label: 'Path', optional: true, hint: '/chat-history/' }
        ]
    },
    {
        id: 'sftp', name: 'SFTP', icon: '🔒', visible: false, fields: [
            { key: 'host', label: 'Host', hint: 'sftp.example.com' },
            { key: 'port', label: 'Port', hint: '22' },
            { key: 'user', label: 'Username' },
            { key: 'pass', label: 'Password', secret: true },
            { key: 'path', label: 'Remote Path', optional: true, hint: '/home/user/backup/' }
        ]
    },
    {
        id: 'ftp', name: 'FTP', icon: '📡', visible: false, fields: [
            { key: 'host', label: 'Host', hint: 'ftp.example.com' },
            { key: 'port', label: 'Port', hint: '21' },
            { key: 'user', label: 'Username' },
            { key: 'pass', label: 'Password', secret: true },
            { key: 'path', label: 'Remote Path', optional: true, hint: '/backup/' }
        ]
    },
    {
        id: 'minio', name: 'MinIO', icon: '🗄️', visible: false, fields: [
            { key: 'endpoint', label: 'Endpoint', hint: 'https://minio.example.com' },
            { key: 'accessKey', label: 'Access Key', secret: true },
            { key: 'secretKey', label: 'Secret Key', secret: true },
            { key: 'bucket', label: 'Bucket' },
            { key: 'path', label: 'Path Prefix', optional: true, hint: 'chat-history/' }
        ]
    },
    {
        id: 'b2', name: 'Backblaze B2', icon: '🅱️', visible: true, fields: [
            { key: 'keyId', label: 'Application Key ID', secret: true },
            { key: 'applicationKey', label: 'Application Key', secret: true },
            { key: 'bucket', label: 'Bucket' },
            { key: 'path', label: 'Path Prefix', optional: true, hint: 'chat-history/' }
        ]
    },
    {
        id: 'r2', name: 'Cloudflare R2', icon: '🟠', visible: true, fields: [
            { key: 'accessKey', label: 'R2 Access Key ID', secret: true, hint: 'From R2 → Manage R2 API Tokens' },
            { key: 'secretKey', label: 'R2 Secret Access Key', secret: true },
            { key: 'accountId', label: 'Account ID', hint: '896cd94cbb...' },
            { key: 'bucket', label: 'Bucket' },
            { key: 'path', label: 'Path Prefix', optional: true, hint: 'chat-history/' }
        ]
    }
]

function getStatusConfig() {
    return {
        running: { color: '#4CAF50', bgColor: 'rgba(76,175,80,0.1)', label: I18n.t('ui.running'), pulse: true },
        configuring: { color: '#FF9800', bgColor: 'rgba(255,152,0,0.1)', label: I18n.t('ui.configuring'), pulse: true },
        starting: { color: '#FF9800', bgColor: 'rgba(255,152,0,0.1)', label: I18n.t('ui.starting'), pulse: true },
        stopped: { color: '#8E8E93', bgColor: 'rgba(142,142,147,0.1)', label: I18n.t('ui.stopped'), pulse: false },
        error: { color: '#EF5350', bgColor: 'rgba(239,83,80,0.1)', label: I18n.t('ui.error'), pulse: false },
        unknown: { color: '#8E8E93', bgColor: 'rgba(142,142,147,0.1)', label: I18n.t('ui.unknown'), pulse: false }
    }
}

function getProvisionSteps() {
    return [
        I18n.t('deploy.stepCreateServer'),
        I18n.t('deploy.stepWaitServer'),
        I18n.t('deploy.stepConnectSsh'),
        I18n.t('deploy.stepInstallDeps'),
        I18n.t('deploy.stepDeployOpenClaw'),
        I18n.t('deploy.stepConfigureGateway'),
        I18n.t('deploy.stepSetupSsl'),
        I18n.t('deploy.stepFinalizing')
    ]
}

const AI_PROVIDERS = [
    { id: 'claude', name: 'Claude', company: 'Anthropic', envVar: 'ANTHROPIC_API_KEY', prefix: 'anthropic' },
    { id: 'openai', name: 'GPT', company: 'OpenAI', envVar: 'OPENAI_API_KEY', prefix: 'openai' },
    { id: 'gemini', name: 'Gemini', company: 'Google', envVar: 'GEMINI_API_KEY', prefix: 'google' },
    { id: 'other', name: 'Other', company: 'xAI & more', envVar: 'XAI_API_KEY', prefix: 'xai' }
]

const AI_MODEL_OPTIONS = {
    claude: [
        { id: 'claude-opus-4.6', apiModelId: 'claude-opus-4-6', name: 'Claude Opus 4.6', desc: '3x · Latest flagship', isDefault: true },
        { id: 'claude-opus-4.5', apiModelId: 'claude-opus-4-5', name: 'Claude Opus 4.5', desc: '3x · Flagship' },
        { id: 'claude-sonnet-4.6', apiModelId: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', desc: '1x · Latest balanced' },
        { id: 'claude-sonnet-4.5', apiModelId: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', desc: '1x · Balanced' },
        { id: 'claude-sonnet-4', apiModelId: 'claude-sonnet-4', name: 'Claude Sonnet 4', desc: '1x · Stable' },
        { id: 'claude-haiku-4.5', apiModelId: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', desc: '0.33x · Fast & affordable' }
    ],
    openai: [
        { id: 'gpt-5.4', apiModelId: 'gpt-5.4', name: 'GPT-5.4', desc: '1x · Latest', isDefault: true },
        { id: 'gpt-5.3-codex', apiModelId: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', desc: '1x · Code gen' },
        { id: 'gpt-5.2-codex', apiModelId: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', desc: '1x · Code gen' },
        { id: 'gpt-5.2', apiModelId: 'gpt-5.2', name: 'GPT-5.2', desc: '1x · General' },
        { id: 'gpt-5.1-codex-max', apiModelId: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', desc: '1x · Code gen' },
        { id: 'gpt-5.1', apiModelId: 'gpt-5.1', name: 'GPT-5.1', desc: '1x · General' },
        { id: 'gpt-5.1-codex-mini', apiModelId: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', desc: '0.33x · Preview' }
    ],
    gemini: [
        { id: 'gemini-3.1-pro-preview', apiModelId: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)', desc: '1x · Latest preview', isDefault: true },
        { id: 'gemini-3-pro-preview', apiModelId: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (Preview)', desc: '1x · Preview' },
        { id: 'gemini-3-flash-preview', apiModelId: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', desc: '0.33x · Fast preview' },
        { id: 'gemini-2.5-pro', apiModelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: '1x · Stable' }
    ],
    other: [
        { id: 'grok-code-fast-1', apiModelId: 'grok-code-fast-1', name: 'Grok Code Fast 1', desc: '0.25x · Fast coding', isDefault: true }
    ]
}

let currentTab = 'claws'
let selectedProvider = null
let selectedPlan = null
let selectedAIProvider = 'claude'
let selectedAIModel = 'claude-opus-4.6'
let clawsList = []
let provisionTimers = {}
let isDeploying = false
let currentDeployClawId = null
let storageRemotes = []
let editingRemoteId = null
let mountingClawId = null
let clawModelAssignments = {}
let syncingClawIds = {}

document.addEventListener('DOMContentLoaded', async () => {
    await I18n.init()
    I18n.applyToPage()

    const popupLangSelect = document.getElementById('popup-language-select')
    if (popupLangSelect) {
        popupLangSelect.value = I18n.getLang()
        popupLangSelect.addEventListener('change', async () => {
            I18n.setLang(popupLangSelect.value)
            await refreshLocalizedUI()
        })
    }

    const hasSession = await ensureAuthenticatedSession()

    if (hasSession) {
        showMainApp()
        loadClaws()
    } else {
        showAuthScreen()
    }

    setupEventListeners()
    renderProviderGrid()
    renderAIProviderGrid()
    renderAIModelSelect()
    renderConfigProviders()
    renderAIConfigProviders()
    setupStoragePage()
    setupChatEventListeners()
    loadClawModelAssignments()
})

async function refreshLocalizedUI() {
    I18n.applyToPage()

    const popupLangSelect = document.getElementById('popup-language-select')
    if (popupLangSelect) {
        popupLangSelect.value = I18n.getLang()
    }

    if (authService.isAuthenticated()) {
        updateAccountPage()
        renderProviderGrid()
        renderAIProviderGrid()
        renderAIModelSelect()
        renderConfigProviders()
        renderAIConfigProviders()
        if (clawsList.length > 0) {
            renderClawsList(clawsList)
        }
    }

    if (currentTab === 'storage') {
        await loadStorageRemotes()
    }
}

async function ensureAuthenticatedSession() {
    await authService.init()

    if (authService.isAuthenticated()) {
        return true
    }

    try {
        await authService.signInAnonymously()
        return true
    } catch (e) {
        showAuthError(e.message || 'Anonymous sign-in failed')
        return false
    }
}

function setupEventListeners() {
    document.getElementById('btn-sign-in').addEventListener('click', handleSignIn)
    document.getElementById('btn-sign-up').addEventListener('click', handleSignUp)
    document.getElementById('btn-guest').addEventListener('click', handleGuestSignIn)
    document.getElementById('btn-link-google').addEventListener('click', handleLinkGoogle)
    document.getElementById('btn-refresh').addEventListener('click', loadClaws)
    document.getElementById('btn-open-agent').addEventListener('click', () => {
        if (window.parent !== window) {
            window.parent.postMessage({ type: 'SWITCH_TO_CHAT' }, '*')
        } else {
            chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' })
        }
    })
    document.getElementById('btn-deploy').addEventListener('click', handleDeploy)
    document.getElementById('btn-sign-out').addEventListener('click', handleSignOut)
    document.getElementById('btn-cancel-deploy').addEventListener('click', handleCancelDeploy)
    document.getElementById('btn-view-claws').addEventListener('click', () => {
        switchTab('claws')
        loadClaws()
    })

    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab))
    })

    document.getElementById('auth-email').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('auth-password').focus()
    })
    document.getElementById('auth-password').addEventListener('keydown', e => {
        if (e.key === 'Enter') handleSignIn()
    })

    document.addEventListener('click', e => {
        const el = e.target.closest('[data-action]')
        if (!el) {
            if (!e.target.closest('.model-picker-dropdown') && !e.target.closest('[data-action="pick-claw-model"]')) {
                document.querySelectorAll('.model-picker-dropdown').forEach(d => d.classList.add('hidden'))
            }
            return
        }
        const action = el.dataset.action
        switch (action) {
            case 'switch-tab':
                switchTab(el.dataset.tab)
                break
            case 'load-claws':
                loadClaws()
                break
            case 'copy':
                copyToClipboard(el.dataset.copyText)
                break
            case 'paste':
                pasteToInput(el.dataset.target)
                break
            case 'toggle-visibility':
                toggleTokenVisibility(el.dataset.target)
                break
            case 'save-config':
                saveProviderConfig(el.dataset.provider)
                break
            case 'sync-config':
                syncProviderConfig(el.dataset.provider)
                break
            case 'sync-remote':
                handleSyncRemote(el.dataset.remoteId)
                break
            case 'edit-remote':
                editStorageRemote(el.dataset.remoteId)
                break
            case 'delete-remote':
                deleteStorageRemote(el.dataset.remoteId)
                break
            case 'pick-claw-model':
                toggleClawModelPicker(el.dataset.clawId)
                break
            case 'sync-claw-ai':
                syncClawAIConfig(el.dataset.clawId)
                break
        }
    })
}

function showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden')
    document.getElementById('main-app').classList.add('hidden')
}

function showMainApp() {
    document.getElementById('auth-screen').classList.add('hidden')
    document.getElementById('main-app').classList.remove('hidden')
    updateAccountPage()
}

function switchTab(tab) {
    currentTab = tab
    document.querySelectorAll('.nav-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab)
    })
    document.querySelectorAll('.page').forEach(p => {
        p.classList.toggle('active', p.id === `page-${tab}`)
    })
    if (tab === 'claws') loadClaws()
    if (tab === 'storage') loadStorageRemotes()
    if (tab === 'chat' && !chatManager.activeClaw) {
        document.getElementById('chat-empty').classList.add('hidden')
        document.getElementById('chat-no-claw').classList.remove('hidden')
    } else if (tab === 'chat' && chatManager.activeClaw) {
        document.getElementById('chat-no-claw').classList.add('hidden')
    }
}

async function handleSignIn() {
    const email = document.getElementById('auth-email').value.trim()
    const password = document.getElementById('auth-password').value
    if (!email || !password) {
        showAuthError(I18n.t('auth.enterCredentials'))
        return
    }
    try {
        hideAuthError()
        document.getElementById('btn-sign-in').disabled = true
        document.getElementById('btn-sign-in').textContent = I18n.t('auth.signingIn')
        await authService.signInWithEmail(email, password)
        showMainApp()
        loadClaws()
        if (window.parent !== window) window.parent.postMessage({ type: 'AUTH_CHANGED' }, '*')
    } catch (e) {
        showAuthError(e.message)
    } finally {
        document.getElementById('btn-sign-in').disabled = false
        document.getElementById('btn-sign-in').textContent = I18n.t('auth.signIn')
    }
}

async function handleSignUp() {
    const email = document.getElementById('auth-email').value.trim()
    const password = document.getElementById('auth-password').value
    if (!email || !password) {
        showAuthError(I18n.t('toast.enterEmailPassword'))
        return
    }
    if (password.length < 6) {
        showAuthError(I18n.t('toast.passwordMinLength'))
        return
    }
    try {
        hideAuthError()
        document.getElementById('btn-sign-up').disabled = true
        document.getElementById('btn-sign-up').textContent = I18n.t('auth.creatingAccount')
        await authService.signUpWithEmail(email, password)
        showMainApp()
        loadClaws()
        if (window.parent !== window) window.parent.postMessage({ type: 'AUTH_CHANGED' }, '*')
    } catch (e) {
        showAuthError(e.message)
    } finally {
        document.getElementById('btn-sign-up').disabled = false
        document.getElementById('btn-sign-up').textContent = I18n.t('auth.createAccount')
    }
}

async function handleGuestSignIn() {
    try {
        hideAuthError()
        document.getElementById('btn-guest').disabled = true
        await authService.signInAnonymously()
        showMainApp()
        loadClaws()
        if (window.parent !== window) window.parent.postMessage({ type: 'AUTH_CHANGED' }, '*')
    } catch (e) {
        showAuthError(e.message)
    } finally {
        document.getElementById('btn-guest').disabled = false
    }
}

async function handleLinkGoogle() {
    const button = document.getElementById('btn-link-google')
    const label = button.querySelector('[data-role="label"]')

    try {
        button.classList.add('disabled')
        label.textContent = I18n.t('auth.linkingGoogle')
        await authService.linkWithGoogle()
        updateAccountPage()
        showToast(I18n.t('toast.googleLinked'), 'success')
        if (window.parent !== window) window.parent.postMessage({ type: 'AUTH_CHANGED' }, '*')
    } catch (e) {
        showToast(e.message, 'error')
    } finally {
        button.classList.remove('disabled')
        label.textContent = I18n.t('auth.linkGoogle')
    }
}

async function handleSignOut() {
    await authService.signOut()
    Object.values(provisionTimers).forEach(clearInterval)
    provisionTimers = {}

    if (await ensureAuthenticatedSession()) {
        showMainApp()
        loadClaws()
        if (window.parent !== window) window.parent.postMessage({ type: 'AUTH_CHANGED' }, '*')
        return
    }

    showAuthScreen()
}

function showAuthError(msg) {
    const el = document.getElementById('auth-error')
    el.textContent = msg
    el.classList.remove('hidden')
}

function hideAuthError() {
    document.getElementById('auth-error').classList.add('hidden')
}

async function loadClaws() {
    const loading = document.getElementById('claws-loading')
    const empty = document.getElementById('claws-empty')
    const error = document.getElementById('claws-error')
    const list = document.getElementById('claws-list')

    loading.classList.remove('hidden')
    empty.classList.add('hidden')
    error.classList.add('hidden')
    list.innerHTML = ''

    try {
        clawsList = await apiClient.getClaws()
        loading.classList.add('hidden')

        if (clawsList.length === 0) {
            empty.classList.remove('hidden')
        } else {
            renderClawsList(clawsList)
            clawsList.forEach(claw => {
                const status = (claw.status || '').toLowerCase()
                if (status === 'configuring' || status === 'starting' || status === 'initializing') {
                    startProvisionPolling(claw.id)
                }
            })
        }
    } catch (e) {
        loading.classList.add('hidden')
        error.classList.remove('hidden')
        document.getElementById('claws-error-msg').textContent = e.message
    }
}

function renderClawsList(claws) {
    const list = document.getElementById('claws-list')
    list.innerHTML = claws.map(claw => createClawCard(claw)).join('')

    const clawActions = ['start', 'stop', 'restart', 'delete', 'chat', 'gateway', 'mount-storage', 'unmount-storage']
    list.querySelectorAll('[data-action]').forEach(btn => {
        if (clawActions.includes(btn.dataset.action)) {
            btn.addEventListener('click', handleClawAction)
        }
    })
}

function createClawCard(claw) {
    const status = normalizeStatus(claw.status)
    const statusConfig = getStatusConfig()
    const config = statusConfig[status] || statusConfig.unknown
    const specs = parsePlanSpecs(claw.planId || '')
    const cpu = claw.cpu || specs.cpu || 0
    const memory = claw.memory || specs.memory || 0
    const storage = claw.storage || specs.storage || 0
    const ip = claw.ip || claw.ipAddress || ''
    const provider = claw.provider || 'hetzner'
    const providerLabel = PROVIDERS.find(p => p.id === provider)?.name || provider

    return `
        <div class="card" data-claw-id="${escapeHtml(claw.id)}">
            <div class="claw-card-header">
                <div>
                    <div class="claw-card-name">${escapeHtml(claw.name || I18n.t('ui.openclawInstance'))}</div>
                    <div class="claw-card-provider">${escapeHtml(providerLabel)} · ${escapeHtml(claw.planId || '')}</div>
                </div>
                <span class="status-badge ${status}">
                    <span class="status-dot ${config.pulse ? 'pulse' : ''}"></span>
                    ${config.label}
                </span>
            </div>
            <div class="claw-card-specs">
                <span class="spec-item">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M232,96a8,8,0,0,0,8-8V64a16,16,0,0,0-16-16H32A16,16,0,0,0,16,64V88a8,8,0,0,0,8,8,24,24,0,0,1,0,48,8,8,0,0,0-8,8v24a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V168a8,8,0,0,0-8-8,24,24,0,0,1,0-48Z"/></svg>
                    ${cpu} vCPU
                </span>
                <span class="spec-item">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M232,56H24A16,16,0,0,0,8,72V184a16,16,0,0,0,16,16H232a16,16,0,0,0,16-16V72A16,16,0,0,0,232,56Z"/></svg>
                    ${memory} GB
                </span>
                <span class="spec-item">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M224,64H32A16,16,0,0,0,16,80v96a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V80A16,16,0,0,0,224,64Z"/></svg>
                    ${storage} GB
                </span>
            </div>
            ${buildModelSelectorHTML(claw)}
            ${buildSyncButtonHTML(claw, status)}
            ${ip ? `
                <div class="claw-card-ip">
                    <span>${escapeHtml(ip)}</span>
                    <button class="copy-btn" data-action="copy" data-copy-text="${escapeHtml(ip)}" title="${escapeHtml(I18n.t('ui.copyIp'))}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"/></svg>
                    </button>
                </div>
            ` : ''}
            <div class="storage-mount-row">
                <div class="storage-mount-info">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="${claw.storageMountEnabled ? '#4CAF50' : '#8E8E93'}" viewBox="0 0 256 256"><path d="M224,64H32A16,16,0,0,0,16,80v96a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V80A16,16,0,0,0,224,64Zm0,112H32V80H224v96ZM208,128a12,12,0,1,1-12-12A12,12,0,0,1,208,128Zm-40,0a12,12,0,1,1-12-12A12,12,0,0,1,168,128Z"/></svg>
                    <span style="font-size: 11px; color: var(--text-secondary)">${I18n.t('ui.storage')}</span>
                    <span class="storage-mount-dot ${claw.storageMountEnabled ? 'mounted' : ''}"></span>
                    <span style="font-size: 10px; color: ${claw.storageMountEnabled ? 'var(--success)' : 'var(--text-muted)'}">${claw.storageMountEnabled ? I18n.t('ui.mounted') : I18n.t('ui.notMounted')}</span>
                </div>
                ${status === 'running' ? `
                    ${claw.storageMountEnabled ? `
                        <button class="btn btn-secondary btn-small" data-action="unmount-storage" data-claw-id="${escapeHtml(claw.id)}" data-claw-name="${escapeHtml(claw.name || I18n.t('ui.thisInstance'))}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M224,176a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,176ZM80.34,125.66a8,8,0,0,0,11.32,0L120,97.31V232a8,8,0,0,0,16,0V97.31l28.34,28.35a8,8,0,0,0,11.32-11.32l-42-42a8,8,0,0,0-11.32,0l-42,42A8,8,0,0,0,80.34,125.66Z"/></svg>
                            ${I18n.t('ui.unmount')}
                        </button>
                    ` : `
                        <button class="btn btn-primary btn-small" data-action="mount-storage" data-claw-id="${escapeHtml(claw.id)}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M224,64H32A16,16,0,0,0,16,80v96a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V80A16,16,0,0,0,224,64Zm0,112H32V80H224v96ZM208,128a12,12,0,1,1-12-12A12,12,0,0,1,208,128Zm-40,0a12,12,0,1,1-12-12A12,12,0,0,1,168,128Z"/></svg>
                            ${I18n.t('ui.mount')}
                        </button>
                    `}
                ` : ''}
            </div>
            <div id="provision-${escapeHtml(claw.id)}" class="hidden"></div>
            <div class="claw-card-actions">
                ${status === 'running' ? `
                    <button class="btn btn-secondary btn-small" data-action="stop" data-claw-id="${escapeHtml(claw.id)}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M200,32H56A24,24,0,0,0,32,56V200a24,24,0,0,0,24,24H200a24,24,0,0,0,24-24V56A24,24,0,0,0,200,32Z"/></svg>
                        ${I18n.t('ui.stop')}
                    </button>
                    <button class="btn btn-secondary btn-small" data-action="restart" data-claw-id="${escapeHtml(claw.id)}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M224,48V96a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h28.69L182.06,73.37a79.56,79.56,0,0,0-56.13-23.43h-.45A79.52,79.52,0,0,0,69.59,72.71,8,8,0,0,1,58.33,61.29,96,96,0,0,1,192.93,60.7L208,75.52V48a8,8,0,0,1,16,0Z"/></svg>
                        ${I18n.t('ui.restart')}
                    </button>
                    <button class="btn btn-accent btn-small" data-action="chat" data-claw-id="${escapeHtml(claw.id)}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M216,48H40A16,16,0,0,0,24,64V224a15.84,15.84,0,0,0,9.25,14.5A16.05,16.05,0,0,0,40,240a15.89,15.89,0,0,0,10.25-3.78l.13-.11L82.5,208H216a16,16,0,0,0,16-16V64A16,16,0,0,0,216,48ZM40,224h0ZM216,192H82.5a16,16,0,0,0-10.3,3.75l-.12.11L40,224V64H216Z"/></svg>
                        ${I18n.t('nav.chat')}
                    </button>
                    ${claw.subdomain ? `
                        <button class="btn btn-primary btn-small" data-action="gateway" data-claw-id="${escapeHtml(claw.id)}" data-subdomain="${escapeHtml(claw.subdomain)}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M224,104a8,8,0,0,1-16,0V59.32l-66.33,66.34a8,8,0,0,1-11.32-11.32L196.68,48H152a8,8,0,0,1,0-16h64a8,8,0,0,1,8,8Zm-40,24a8,8,0,0,0-8,8v72H48V80h72a8,8,0,0,0,0-16H48A16,16,0,0,0,32,80V208a16,16,0,0,0,16,16H176a16,16,0,0,0,16-16V136A8,8,0,0,0,184,128Z"/></svg>
                            ${I18n.t('ui.gateway')}
                        </button>
                    ` : ''}
                ` : ''}
                ${status === 'stopped' ? `
                    <button class="btn btn-secondary btn-small" data-action="start" data-claw-id="${escapeHtml(claw.id)}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M232.4,114.49,88.32,26.35a16,16,0,0,0-16.2-.3A15.86,15.86,0,0,0,64,40.09V215.91a15.86,15.86,0,0,0,8.12,13.81,16,16,0,0,0,16.2-.3L232.4,141.51a16,16,0,0,0,0-27Z"/></svg>
                        ${I18n.t('ui.start')}
                    </button>
                ` : ''}
                <button class="btn btn-danger btn-small" data-action="delete" data-claw-id="${escapeHtml(claw.id)}" data-claw-name="${escapeHtml(claw.name || I18n.t('ui.thisInstance'))}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/></svg>
                    ${I18n.t('ui.delete')}
                </button>
            </div>
        </div>
    `
}

async function handleClawAction(e) {
    const btn = e.currentTarget
    const action = btn.dataset.action
    const clawId = btn.dataset.clawId

    btn.disabled = true

    try {
        switch (action) {
            case 'start':
                await apiClient.startClaw(clawId)
                showToast(I18n.t('toast.instanceStarting'), 'success')
                break
            case 'stop':
                await apiClient.stopClaw(clawId)
                showToast(I18n.t('toast.instanceStopped'), 'success')
                break
            case 'restart':
                await apiClient.restartClaw(clawId)
                showToast(I18n.t('toast.instanceRestarting'), 'success')
                break
            case 'delete':
                if (confirm(I18n.t('ui.confirmDeleteInstance', { name: btn.dataset.clawName }))) {
                    await apiClient.deleteClaw(clawId)
                    showToast(I18n.t('toast.instanceDeleted'), 'success')
                }
                break
            case 'chat':
                openClawChat(clawId)
                return
            case 'gateway': {
                const subdomain = btn.dataset.subdomain
                if (subdomain) {
                    window.open(`https://${subdomain}.digitalenginecore.com`, '_blank')
                }
                break
            }
            case 'mount-storage':
                await handleMountStorage(clawId, btn)
                break
            case 'unmount-storage':
                if (confirm(I18n.t('ui.confirmUnmountStorage', { name: btn.dataset.clawName }))) {
                    btn.disabled = true
                    btn.innerHTML = '<div class="spinner" style="width:12px;height:12px;border-width:2px"></div> ' + I18n.t('ui.unmounting')
                    const result = await apiClient.unmountClawStorage(clawId)
                    if (result) {
                        showToast(I18n.t('toast.storageUnmounted'), 'success')
                    } else {
                        showToast(I18n.t('toast.storageUnmountFailed'), 'error')
                    }
                }
                break
        }
        setTimeout(loadClaws, 1000)
    } catch (e) {
        showToast(e.message, 'error')
    } finally {
        btn.disabled = false
    }
}

function renderProviderGrid() {
    const grid = document.getElementById('provider-grid')
    grid.innerHTML = PROVIDERS.map(p => `
        <div class="provider-card ${selectedProvider === p.id ? 'selected' : ''}" data-provider="${p.id}">
            <span style="font-size: 24px">${p.icon}</span>
            <span>${p.name}</span>
        </div>
    `).join('')

    grid.querySelectorAll('.provider-card').forEach(card => {
        card.addEventListener('click', () => selectProvider(card.dataset.provider))
    })
}

function renderAIProviderGrid() {
    const grid = document.getElementById('ai-provider-grid')
    if (!grid) return
    const icons = { claude: '🟤', openai: '🟢', gemini: '🔵', other: '⚡' }
    grid.innerHTML = AI_PROVIDERS.map(p => `
        <div class="provider-card ${selectedAIProvider === p.id ? 'selected' : ''}" data-ai-provider="${p.id}">
            <span style="font-size: 24px">${icons[p.id] || '🤖'}</span>
            <span>${p.name}</span>
            <span style="font-size: 9px; color: var(--text-muted)">${p.company}</span>
        </div>
    `).join('')

    grid.querySelectorAll('.provider-card').forEach(card => {
        card.addEventListener('click', () => {
            selectedAIProvider = card.dataset.aiProvider
            renderAIProviderGrid()
            renderAIModelSelect()
        })
    })
}

function renderAIModelSelect() {
    const select = document.getElementById('deploy-ai-model')
    if (!select) return
    const models = AI_MODEL_OPTIONS[selectedAIProvider] || []
    select.innerHTML = models.map(m =>
        `<option value="${m.id}" ${m.isDefault ? 'selected' : ''}>${m.name} — ${m.desc}</option>`
    ).join('')
    const defaultModel = models.find(m => m.isDefault) || models[0]
    if (defaultModel) selectedAIModel = defaultModel.id
    select.onchange = () => { selectedAIModel = select.value }
}

async function selectProvider(providerId) {
    selectedProvider = providerId
    selectedPlan = null
    renderProviderGrid()
    updateDeployButton()

    const plansLoading = document.getElementById('plans-loading')
    const plansList = document.getElementById('plans-list')
    const regionSelect = document.getElementById('deploy-region')

    plansLoading.classList.remove('hidden')
    plansList.innerHTML = ''
    regionSelect.innerHTML = '<option value="">Loading...</option>'

    try {
        const [plansData, regions] = await Promise.all([
            apiClient.getProviderPlans(providerId),
            apiClient.getProviderRegions(providerId)
        ])

        plansLoading.classList.add('hidden')

        if (plansData && plansData.plans) {
            renderPlans(plansData.plans)
        } else {
            renderDefaultPlans(providerId)
        }

        if (regions.length > 0) {
            regionSelect.innerHTML = regions.map(r =>
                `<option value="${escapeHtml(r.id || r.slug || r.name)}">${escapeHtml(r.name || r.city || r.id)} ${r.country ? `(${escapeHtml(r.country)})` : ''}</option>`
            ).join('')
        } else {
            renderDefaultRegions(providerId, regionSelect)
        }
    } catch (e) {
        plansLoading.classList.add('hidden')
        renderDefaultPlans(providerId)
        renderDefaultRegions(providerId, regionSelect)
    }
}

function renderPlans(plans) {
    const plansList = document.getElementById('plans-list')
    plansList.innerHTML = plans.map(plan => `
        <div class="plan-card ${selectedPlan === plan.id ? 'selected' : ''}" data-plan-id="${escapeHtml(plan.id)}">
            <div class="plan-card-info">
                <span class="plan-card-name">${escapeHtml(plan.name || plan.id)}</span>
                <span class="plan-card-specs">${plan.cpu || '?'} vCPU · ${plan.memory || '?'} GB RAM · ${plan.storage || plan.disk || '?'} GB SSD</span>
            </div>
        </div>
    `).join('')

    plansList.querySelectorAll('.plan-card').forEach(card => {
        card.addEventListener('click', () => {
            selectedPlan = card.dataset.planId
            plansList.querySelectorAll('.plan-card').forEach(c => c.classList.remove('selected'))
            card.classList.add('selected')
            updateDeployButton()
        })
    })
}

function renderDefaultPlans(providerId) {
    const defaults = {
        hetzner: [
            { id: 'cx22', name: 'CX22', cpu: 2, memory: 4, storage: 40 },
            { id: 'cx32', name: 'CX32', cpu: 4, memory: 8, storage: 80 },
            { id: 'cx42', name: 'CX42', cpu: 8, memory: 16, storage: 160 }
        ],
        vultr: [
            { id: 'vc2-1c-2gb', name: 'VC2 1C-2GB', cpu: 1, memory: 2, storage: 55 },
            { id: 'vc2-2c-4gb', name: 'VC2 2C-4GB', cpu: 2, memory: 4, storage: 80 },
            { id: 'vc2-4c-8gb', name: 'VC2 4C-8GB', cpu: 4, memory: 8, storage: 160 }
        ],
        digitalocean: [
            { id: 's-1vcpu-2gb', name: 'Basic 1vCPU', cpu: 1, memory: 2, storage: 50 },
            { id: 's-2vcpu-4gb', name: 'Basic 2vCPU', cpu: 2, memory: 4, storage: 80 },
            { id: 's-4vcpu-8gb', name: 'Basic 4vCPU', cpu: 4, memory: 8, storage: 160 }
        ],
        linode: [
            { id: 'g6-nanode-1', name: 'Nanode 1GB', cpu: 1, memory: 1, storage: 25 },
            { id: 'g6-standard-1', name: 'Linode 2GB', cpu: 1, memory: 2, storage: 50 },
            { id: 'g6-standard-2', name: 'Linode 4GB', cpu: 2, memory: 4, storage: 80 }
        ]
    }
    // Only providers whose server types are known here get a fallback list. For the rest,
    // saying the list did not load beats offering sizes the provider would reject.
    if (!defaults[providerId]) {
        document.getElementById('plans-list').innerHTML =
            `<div class="text-muted" style="font-size: 11px">${escapeHtml(I18n.t('claws.loadFailed'))}</div>`
        return
    }
    renderPlans(defaults[providerId])
}

function renderDefaultRegions(providerId, select) {
    const defaults = {
        hetzner: [
            { id: 'fsn1', name: 'Falkenstein' },
            { id: 'nbg1', name: 'Nuremberg' },
            { id: 'hel1', name: 'Helsinki' },
            { id: 'ash', name: 'Ashburn, VA' }
        ],
        vultr: [
            { id: 'ewr', name: 'New Jersey' },
            { id: 'lax', name: 'Los Angeles' },
            { id: 'ams', name: 'Amsterdam' },
            { id: 'sgp', name: 'Singapore' }
        ],
        digitalocean: [
            { id: 'nyc1', name: 'New York 1' },
            { id: 'sfo3', name: 'San Francisco 3' },
            { id: 'ams3', name: 'Amsterdam 3' },
            { id: 'sgp1', name: 'Singapore 1' }
        ],
        linode: [
            { id: 'us-east', name: 'Newark, NJ' },
            { id: 'us-west', name: 'Fremont, CA' },
            { id: 'eu-west', name: 'London' },
            { id: 'ap-south', name: 'Singapore' }
        ]
    }
    const regions = defaults[providerId] || [
        { id: 'us-east', name: 'US East' },
        { id: 'us-west', name: 'US West' },
        { id: 'eu-west', name: 'EU West' }
    ]
    select.innerHTML = regions.map(r =>
        `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`
    ).join('')
}

function updateDeployButton() {
    const btn = document.getElementById('btn-deploy')
    const name = document.getElementById('deploy-name').value.trim()
    btn.disabled = !selectedProvider || !selectedPlan || !name || isDeploying
}

document.getElementById('deploy-name')?.addEventListener('input', updateDeployButton)

async function handleDeploy() {
    const name = document.getElementById('deploy-name').value.trim()
    const location = document.getElementById('deploy-region').value
    const method = document.getElementById('deploy-method').value

    if (!name || !selectedProvider || !selectedPlan) return

    isDeploying = true
    updateDeployButton()

    document.getElementById('deploy-form').classList.add('hidden')
    document.getElementById('deploy-progress').classList.remove('hidden')
    document.getElementById('btn-cancel-deploy').classList.remove('hidden')
    document.getElementById('btn-view-claws').classList.add('hidden')

    updateProvisionUI(0, 'Creating server...', [])

    try {
        await authService._refreshTokenIfNeeded()

        const stored = await chrome.storage.local.get('provider_configs')
        const providerConfigs = stored.provider_configs || {}
        const providerToken = providerConfigs[selectedProvider] || null

        const aiProvider = AI_PROVIDERS.find(p => p.id === selectedAIProvider)
        const aiModels = AI_MODEL_OPTIONS[selectedAIProvider] || []
        const aiModel = aiModels.find(m => m.id === selectedAIModel) || aiModels[0]

        const result = await apiClient.createClaw({
            name,
            planId: selectedPlan,
            location,
            provider: selectedProvider,
            deploymentMethod: method,
            providerToken,
            aiProvider: selectedAIProvider,
            aiModel: aiModel?.apiModelId || selectedAIModel,
            aiEnvVar: aiProvider?.envVar
        })

        const clawId = result?.data?.id || result?.id
        if (clawId) {
            currentDeployClawId = clawId
            showToast(I18n.t('toast.deployStarted'), 'success')
            startProvisionPolling(currentDeployClawId, true)
        } else {
            throw new Error(I18n.t('ui.failedCreateInstance'))
        }
    } catch (e) {
        if (isOneAgentLimitRefusal(e)) {
            openMoreAgentsPage()
            showToast(I18n.t('toast.oneAgentLimit'), 'info', 6000)
        } else {
            showToast(e.message, 'error')
        }
        resetDeployForm()
    }
}

// The server decides how many agents an account runs. When it refuses another one, the
// website opens in a new tab so the user can carry on from there.
function openMoreAgentsPage() {
    chrome.tabs.create({ url: MORE_AGENTS_URL })
}

function startProvisionPolling(clawId, isDeployPage = false) {
    if (provisionTimers[clawId]) return

    provisionTimers[clawId] = setInterval(async () => {
        try {
            const progress = await apiClient.getProvisionProgress(clawId)
            if (!progress) return

            const percent = progress.percentComplete || 0
            const currentStep = progress.currentStep || ''
            const logs = Array.isArray(progress.logEntries) ? progress.logEntries : []
            const completed = progress.isComplete || false
            const failed = progress.isFailed || false

            if (isDeployPage && currentDeployClawId === clawId) {
                updateProvisionUI(percent, currentStep, logs, completed, failed)
            }

            const provisionEl = document.getElementById(`provision-${clawId}`)
            if (provisionEl) {
                if (!completed && !failed) {
                    provisionEl.classList.remove('hidden')
                    provisionEl.innerHTML = `
                        <div class="progress-bar-container mt-2">
                            <div class="progress-bar ${completed ? 'success' : ''}" style="width: ${percent}%"></div>
                        </div>
                        <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px">${escapeHtml(currentStep)} (${percent}%)</div>
                    `
                } else {
                    provisionEl.classList.add('hidden')
                }
            }

            if (completed || failed) {
                clearInterval(provisionTimers[clawId])
                delete provisionTimers[clawId]

                if (isDeployPage && currentDeployClawId === clawId) {
                    isDeploying = false
                    document.getElementById('btn-cancel-deploy').classList.add('hidden')
                    document.getElementById('btn-view-claws').classList.remove('hidden')

                    if (completed) {
                        showToast(I18n.t('toast.deployComplete'), 'success')
                    } else {
                        showToast(I18n.t('toast.deployFailed'), 'error')
                    }
                }

                if (completed && window.parent !== window) {
                    window.parent.postMessage({ type: 'DEPLOY_COMPLETE' }, '*')
                }

                loadClaws()
            }
        } catch (e) {
            console.error('Provision poll error:', e)
        }
    }, 3000)
}

function updateProvisionUI(percent, step, logs, completed = false, failed = false) {
    document.getElementById('progress-percent').textContent = `${percent}%`
    document.getElementById('progress-bar').style.width = `${percent}%`

    if (completed) {
        document.getElementById('progress-bar').classList.add('success')
        document.getElementById('progress-title').textContent = I18n.t('toast.deployComplete')
    } else if (failed) {
        document.getElementById('progress-title').textContent = I18n.t('toast.deployFailed')
    } else {
        document.getElementById('progress-title').textContent = step || I18n.t('ui.deploying')
    }

    const stepsEl = document.getElementById('progress-steps')
    const provisionSteps = getProvisionSteps()
    let currentStepIdx = provisionSteps.findIndex(s =>
        step && step.toLowerCase().includes(s.toLowerCase().split(' ')[0])
    )
    if (currentStepIdx === -1) currentStepIdx = Math.floor((percent / 100) * provisionSteps.length)

    stepsEl.innerHTML = provisionSteps.map((s, i) => {
        let cls = ''
        let icon = '○'
        if (completed || i < currentStepIdx) {
            cls = 'completed'
            icon = '✓'
        } else if (i === currentStepIdx && !completed && !failed) {
            cls = 'in-progress'
            icon = '⟳'
        } else if (failed && i === currentStepIdx) {
            cls = 'failed'
            icon = '✗'
        }
        return `<div class="provision-step ${cls}"><span class="step-icon ${cls === 'in-progress' ? 'spinning' : ''}">${icon}</span>${s}</div>`
    }).join('')

    if (logs && logs.length > 0) {
        const logsEl = document.getElementById('progress-logs')
        logsEl.classList.remove('hidden')
        logsEl.innerHTML = logs.map(l => {
            const level = (l.level || 'info').toLowerCase()
            const msg = l.message || l.msg || ''
            return `<div class="log-entry ${level}">${escapeHtml(msg)}</div>`
        }).join('')
        logsEl.scrollTop = logsEl.scrollHeight
    }
}

function handleCancelDeploy() {
    if (currentDeployClawId) {
        apiClient.deleteClaw(currentDeployClawId).then(() => {
            showToast(I18n.t('toast.deployCancelled'), 'info')
        })
        if (provisionTimers[currentDeployClawId]) {
            clearInterval(provisionTimers[currentDeployClawId])
            delete provisionTimers[currentDeployClawId]
        }
    }
    resetDeployForm()
}

function resetDeployForm() {
    isDeploying = false
    currentDeployClawId = null
    document.getElementById('deploy-form').classList.remove('hidden')
    document.getElementById('deploy-progress').classList.add('hidden')
    updateDeployButton()
}

function renderConfigProviders() {
    const list = document.getElementById('config-list')
    const configProviders = [
        { id: 'hetzner', name: 'Hetzner', fields: [{ key: 'apiToken', label: 'API Token' }] },
        { id: 'vultr', name: 'Vultr', fields: [{ key: 'apiToken', label: 'API Token' }] },
        { id: 'digitalocean', name: 'DigitalOcean', fields: [{ key: 'apiToken', label: 'API Token' }] },
        { id: 'linode', name: 'Linode (Akamai)', fields: [{ key: 'apiToken', label: 'API Token' }] },
        { id: 'flyio', name: 'Fly.io', fields: [{ key: 'apiToken', label: 'API Token' }] },
        { id: 'railway', name: 'Railway', fields: [{ key: 'apiToken', label: 'API Token' }] },
        {
            id: 'aws', name: 'AWS', fields: [
                { key: 'accessKeyId', label: 'Access Key ID' },
                { key: 'secretAccessKey', label: 'Secret Access Key' },
                { key: 'region', label: 'Region', type: 'text' }
            ]
        },
        { id: 'gcp', name: 'Google Cloud', fields: [{ key: 'serviceAccountKey', label: 'Service Account Key (JSON)' }] },
        {
            id: 'azure', name: 'Azure', fields: [
                { key: 'tenantId', label: 'Tenant ID' },
                { key: 'clientId', label: 'Client ID' },
                { key: 'clientSecret', label: 'Client Secret' },
                { key: 'subscriptionId', label: 'Subscription ID' }
            ]
        },
        {
            id: 'contabo', name: 'Contabo', fields: [
                { key: 'clientId', label: 'Client ID' },
                { key: 'clientSecret', label: 'Client Secret' },
                { key: 'apiUser', label: 'API User' },
                { key: 'apiPassword', label: 'API Password' }
            ]
        },
        {
            id: 'ovhcloud', name: 'OVHcloud', fields: [
                { key: 'appKey', label: 'Application Key' },
                { key: 'appSecret', label: 'Application Secret' },
                { key: 'consumerKey', label: 'Consumer Key' }
            ]
        }
    ]

    list.innerHTML = configProviders.map(provider => `
        <div class="config-provider-card">
            <div class="config-provider-header" data-config-provider="${provider.id}">
                <div class="config-provider-left">
                    <span style="font-size: 18px">${PROVIDERS.find(p => p.id === provider.id)?.icon || '☁️'}</span>
                    <span class="config-provider-name">${provider.name}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px">
                    <span class="config-provider-status" id="config-status-${provider.id}"></span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="#8E8E93" viewBox="0 0 256 256"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/></svg>
                </div>
            </div>
            <div class="config-provider-body" id="config-body-${provider.id}">
                ${provider.fields.map(field => `
                    <div class="form-group">
                        <label class="form-label">${field.label}</label>
                        <div class="token-input-wrapper">
                            <input type="password" class="token-input" id="config-${provider.id}-${field.key}" placeholder="Enter ${field.label.toLowerCase()}">
                            <button class="token-toggle token-paste" data-action="paste" data-target="config-${provider.id}-${field.key}" title="Paste">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M200,32H163.74a47.92,47.92,0,0,0-71.48,0H56A16,16,0,0,0,40,48V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm-72,0a32,32,0,0,1,32,32H96A32,32,0,0,1,128,32Zm72,184H56V48H82.75A47.93,47.93,0,0,0,80,64v8a8,8,0,0,0,8,8h80a8,8,0,0,0,8-8V64a47.93,47.93,0,0,0-2.75-16H200Z"/></svg>
                            </button>
                            <button class="token-toggle" data-action="toggle-visibility" data-target="config-${provider.id}-${field.key}">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,123.97,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.29A169.47,169.47,0,0,1,24.57,128,169.47,169.47,0,0,1,48.07,97.29C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.29A169.47,169.47,0,0,1,231.43,128C223.72,141.72,184.34,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z"/></svg>
                            </button>
                        </div>
                    </div>
                `).join('')}
                <div class="config-actions">
                    <button class="btn btn-secondary btn-small" data-action="save-config" data-provider="${provider.id}">Save Locally</button>
                    <button class="btn btn-primary btn-small" data-action="sync-config" data-provider="${provider.id}">Sync to Cloud</button>
                </div>
            </div>
        </div>
    `).join('')

    list.querySelectorAll('.config-provider-header').forEach(header => {
        header.addEventListener('click', () => {
            const providerId = header.dataset.configProvider
            const body = document.getElementById(`config-body-${providerId}`)
            const isExpanded = body.classList.contains('expanded')
            document.querySelectorAll('.config-provider-body').forEach(b => b.classList.remove('expanded'))
            document.querySelectorAll('.config-provider-header').forEach(h => h.classList.remove('expanded'))
            if (!isExpanded) {
                body.classList.add('expanded')
                header.classList.add('expanded')
            }
        })
    })

    loadSavedConfigs()
}

function renderAIConfigProviders() {
    const list = document.getElementById('ai-config-list')
    if (!list) return
    const icons = { claude: '🟤', openai: '🟢', gemini: '🔵', other: '⚡' }

    list.innerHTML = AI_PROVIDERS.map(provider => `
        <div class="config-provider-card">
            <div class="config-provider-header" data-config-provider="ai-${provider.id}">
                <div class="config-provider-left">
                    <span style="font-size: 18px">${icons[provider.id] || '🤖'}</span>
                    <span class="config-provider-name">${provider.name} (${provider.company})</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px">
                    <span class="config-provider-status" id="config-status-ai-${provider.id}"></span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="#8E8E93" viewBox="0 0 256 256"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/></svg>
                </div>
            </div>
            <div class="config-provider-body" id="config-body-ai-${provider.id}">
                <div class="form-group">
                    <label class="form-label">${provider.envVar}</label>
                    <div class="token-input-wrapper">
                        <input type="password" class="token-input" id="config-ai-${provider.id}-apiKey" placeholder="Enter API key">
                        <button class="token-toggle token-paste" data-action="paste" data-target="config-ai-${provider.id}-apiKey" title="Paste">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M200,32H163.74a47.92,47.92,0,0,0-71.48,0H56A16,16,0,0,0,40,48V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm-72,0a32,32,0,0,1,32,32H96A32,32,0,0,1,128,32Zm72,184H56V48H82.75A47.93,47.93,0,0,0,80,64v8a8,8,0,0,0,8,8h80a8,8,0,0,0,8-8V64a47.93,47.93,0,0,0-2.75-16H200Z"/></svg>
                        </button>
                        <button class="token-toggle" data-action="toggle-visibility" data-target="config-ai-${provider.id}-apiKey">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,123.97,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.29A169.47,169.47,0,0,1,24.57,128,169.47,169.47,0,0,1,48.07,97.29C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.29A169.47,169.47,0,0,1,231.43,128C223.72,141.72,184.34,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z"/></svg>
                        </button>
                    </div>
                </div>
                <div class="config-actions">
                    <button class="btn btn-secondary btn-small" data-action="save-config" data-provider="ai-${provider.id}">Save Locally</button>
                    <button class="btn btn-primary btn-small" data-action="sync-config" data-provider="ai-${provider.id}">Sync to Cloud</button>
                </div>
            </div>
        </div>
    `).join('')

    list.querySelectorAll('.config-provider-header').forEach(header => {
        header.addEventListener('click', () => {
            const providerId = header.dataset.configProvider
            const body = document.getElementById(`config-body-${providerId}`)
            const isExpanded = body.classList.contains('expanded')
            document.querySelectorAll('.config-provider-body').forEach(b => b.classList.remove('expanded'))
            document.querySelectorAll('.config-provider-header').forEach(h => h.classList.remove('expanded'))
            if (!isExpanded) {
                body.classList.add('expanded')
                header.classList.add('expanded')
            }
        })
    })

    loadSavedAIConfigs()
}

async function loadSavedAIConfigs() {
    const stored = await chrome.storage.local.get('ai_configs')
    const configs = stored.ai_configs || {}

    Object.entries(configs).forEach(([providerId, config]) => {
        const input = document.getElementById(`config-ai-${providerId}-apiKey`)
        if (input && config.apiKey) input.value = config.apiKey
        const statusEl = document.getElementById(`config-status-ai-${providerId}`)
        if (statusEl) statusEl.classList.toggle('configured', !!(config.apiKey && config.apiKey.length > 0))
    })
}

async function loadSavedConfigs() {
    const stored = await chrome.storage.local.get('provider_configs')
    const configs = stored.provider_configs || {}

    Object.entries(configs).forEach(([providerId, config]) => {
        Object.entries(config).forEach(([key, value]) => {
            const input = document.getElementById(`config-${providerId}-${key}`)
            if (input) input.value = value
        })
        const statusEl = document.getElementById(`config-status-${providerId}`)
        if (statusEl) {
            const hasValue = Object.values(config).some(v => v && v.length > 0)
            statusEl.classList.toggle('configured', hasValue)
        }
    })
}

async function saveProviderConfig(providerId) {
    const isAI = providerId.startsWith('ai-')
    const storageKey = isAI ? 'ai_configs' : 'provider_configs'
    const stored = await chrome.storage.local.get(storageKey)
    const configs = stored[storageKey] || {}

    const inputs = document.querySelectorAll(`[id^="config-${providerId}-"]`)
    const config = {}
    inputs.forEach(input => {
        const key = input.id.replace(`config-${providerId}-`, '')
        config[key] = input.value
    })

    const configKey = isAI ? providerId.replace('ai-', '') : providerId
    configs[configKey] = config
    await chrome.storage.local.set({ [storageKey]: configs })

    const statusEl = document.getElementById(`config-status-${providerId}`)
    if (statusEl) {
        const hasValue = Object.values(config).some(v => v && v.length > 0)
        statusEl.classList.toggle('configured', hasValue)
    }

    showToast(I18n.t('toast.configSaved'), 'success')
}

async function syncProviderConfig(providerId) {
    const isAI = providerId.startsWith('ai-')
    const storageKey = isAI ? 'ai_configs' : 'provider_configs'
    const stored = await chrome.storage.local.get(storageKey)
    const configs = stored[storageKey] || {}
    const configKey = isAI ? providerId.replace('ai-', '') : providerId
    const config = configs[configKey]

    if (!config || Object.values(config).every(v => !v)) {
        showToast(I18n.t('toast.enterTokenFirst'), 'error')
        return
    }

    const result = await apiClient.syncProviderConfig(isAI ? `ai/${configKey}` : providerId, config)
    if (result) {
        showToast(I18n.t('toast.configSynced'), 'success')
    } else {
        showToast(I18n.t('toast.syncFailed'), 'error')
    }
}

function toggleTokenVisibility(inputId) {
    const input = document.getElementById(inputId)
    if (input) {
        input.type = input.type === 'password' ? 'text' : 'password'
    }
}

async function pasteToInput(inputId) {
    const input = document.getElementById(inputId)
    if (!input) return
    try {
        const text = await navigator.clipboard.readText()
        input.value = text
        input.dispatchEvent(new Event('input'))
        showToast(I18n.t('toast.pastedClipboard'), 'success')
    } catch {
        showToast(I18n.t('toast.clipboardFailed'), 'error')
    }
}

function updateAccountPage() {
    const user = authService.currentUser
    if (!user) return

    const avatar = document.getElementById('account-avatar')
    const name = document.getElementById('account-name')
    const email = document.getElementById('account-email')
    const badge = document.getElementById('account-badge')
    const linkGoogle = document.getElementById('btn-link-google')

    const displayName = user.displayName || user.email || 'Guest'
    avatar.textContent = displayName.charAt(0).toUpperCase()
    name.textContent = displayName
    email.textContent = user.email || I18n.t('account.anonymousSession')

    if (user.isAnonymous) {
        badge.innerHTML = `<span class="account-badge guest">${I18n.t('account.guest')}</span>`
        linkGoogle.classList.remove('hidden')
    } else {
        const statusKey = user.providerId === 'google.com' ? 'account.googleLinked' : 'account.signedIn'
        badge.innerHTML = `<span class="account-badge signed-in">${I18n.t(statusKey)}</span>`
        linkGoogle.classList.add('hidden')
    }
}

function normalizeStatus(status) {
    const s = (status || '').toLowerCase()
    if (s === 'starting' || s === 'initializing') return 'configuring'
    if (['running', 'configuring', 'stopped', 'error'].includes(s)) return s
    return 'unknown'
}

function parsePlanSpecs(planId) {
    const lower = planId.toLowerCase()
    const specMap = {
        cx22: { cpu: 2, memory: 4, storage: 40 },
        cx23: { cpu: 2, memory: 4, storage: 40 },
        cx32: { cpu: 4, memory: 8, storage: 80 },
        cx33: { cpu: 4, memory: 8, storage: 80 },
        cx42: { cpu: 8, memory: 16, storage: 160 },
        cx43: { cpu: 8, memory: 16, storage: 160 },
        cx52: { cpu: 16, memory: 32, storage: 320 },
        cx53: { cpu: 16, memory: 32, storage: 320 },
        cax11: { cpu: 2, memory: 4, storage: 40 },
        cax21: { cpu: 4, memory: 8, storage: 80 },
        cax31: { cpu: 8, memory: 16, storage: 160 },
        cax41: { cpu: 16, memory: 32, storage: 320 },
        ccx13: { cpu: 2, memory: 8, storage: 80 },
        ccx23: { cpu: 4, memory: 16, storage: 160 },
        ccx33: { cpu: 8, memory: 32, storage: 240 },
        ccx43: { cpu: 16, memory: 64, storage: 360 },
        ccx53: { cpu: 32, memory: 128, storage: 600 },
        ccx63: { cpu: 48, memory: 192, storage: 960 },
        cpx11: { cpu: 2, memory: 2, storage: 40 },
        cpx21: { cpu: 3, memory: 4, storage: 80 },
        cpx31: { cpu: 4, memory: 8, storage: 160 },
        cpx41: { cpu: 8, memory: 16, storage: 240 },
        cpx51: { cpu: 16, memory: 32, storage: 360 },
        'vc2-1c-1gb': { cpu: 1, memory: 1, storage: 25 },
        'vc2-1c-2gb': { cpu: 1, memory: 2, storage: 55 },
        'vc2-2c-4gb': { cpu: 2, memory: 4, storage: 80 },
        'vc2-4c-8gb': { cpu: 4, memory: 8, storage: 160 },
        's-1vcpu-1gb': { cpu: 1, memory: 1, storage: 25 },
        's-1vcpu-2gb': { cpu: 1, memory: 2, storage: 50 },
        's-2vcpu-4gb': { cpu: 2, memory: 4, storage: 80 },
        's-4vcpu-8gb': { cpu: 4, memory: 8, storage: 160 },
        'g6-nanode-1': { cpu: 1, memory: 1, storage: 25 },
        'g6-standard-1': { cpu: 1, memory: 2, storage: 50 },
        'g6-standard-2': { cpu: 2, memory: 4, storage: 80 }
    }
    return specMap[lower] || { cpu: 0, memory: 0, storage: 0 }
}

const AI_PROVIDER_COLORS = {
    claude: '#D4A574',
    openai: '#10A37F',
    gemini: '#4285F4',
    other: '#FF6B35'
}

const AI_PROVIDER_ICONS = {
    claude: '🟤',
    openai: '🟢',
    gemini: '🔵',
    other: '⚡'
}

async function loadClawModelAssignments() {
    const stored = await chrome.storage.local.get('claw_model_assignments')
    clawModelAssignments = stored.claw_model_assignments || {}
}

async function saveClawModelAssignment(clawId, providerId, modelId) {
    clawModelAssignments[clawId] = { provider: providerId, model: modelId }
    await chrome.storage.local.set({ claw_model_assignments: clawModelAssignments })
}

async function removeClawModelAssignment(clawId) {
    delete clawModelAssignments[clawId]
    await chrome.storage.local.set({ claw_model_assignments: clawModelAssignments })
}

function getEffectiveClawModel(clawId) {
    const assignment = clawModelAssignments[clawId]
    if (assignment) {
        const models = AI_MODEL_OPTIONS[assignment.provider] || []
        const model = models.find(m => m.id === assignment.model)
        if (model) {
            return { provider: assignment.provider, model }
        }
    }
    return null
}

function buildModelSelectorHTML(claw) {
    const effective = getEffectiveClawModel(claw.id)
    const hasModel = !!effective
    const color = hasModel ? AI_PROVIDER_COLORS[effective.provider] : '#8E8E93'
    const icon = hasModel ? AI_PROVIDER_ICONS[effective.provider] : '🧠'
    const label = hasModel ? effective.model.name : I18n.t('ui.tapToSelectModel')
    const isCustom = !!clawModelAssignments[claw.id]

    return `
        <div class="model-selector-chip" data-action="pick-claw-model" data-claw-id="${escapeHtml(claw.id)}" style="--chip-color: ${color}">
            <span class="model-selector-icon">${icon}</span>
            <span class="model-selector-label" style="color: ${color}">${escapeHtml(label)}</span>
            ${isCustom ? `<span class="model-custom-badge" style="background: ${color}22; color: ${color}">${I18n.t('ui.custom')}</span>` : ''}
            <svg class="model-selector-caret" xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="#8E8E93" viewBox="0 0 256 256"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/></svg>
        </div>
        <div class="model-picker-dropdown hidden" id="model-picker-${escapeHtml(claw.id)}">
            ${buildModelPickerOptions(claw.id)}
        </div>
    `
}

function buildModelPickerOptions(clawId) {
    const current = clawModelAssignments[clawId]
    let html = ''
    for (const provider of AI_PROVIDERS) {
        const models = AI_MODEL_OPTIONS[provider.id] || []
        const color = AI_PROVIDER_COLORS[provider.id]
        const icon = AI_PROVIDER_ICONS[provider.id]
        html += `<div class="model-picker-group">`
        html += `<div class="model-picker-group-label">${icon} ${escapeHtml(provider.name)} <span style="color: var(--text-muted); font-weight: 400">${escapeHtml(provider.company)}</span></div>`
        for (const model of models) {
            const isSelected = current && current.provider === provider.id && current.model === model.id
            html += `
                <div class="model-picker-option ${isSelected ? 'selected' : ''}" data-claw-id="${escapeHtml(clawId)}" data-provider-id="${provider.id}" data-model-id="${model.id}">
                    <div class="model-picker-option-name">${escapeHtml(model.name)}</div>
                    <div class="model-picker-option-desc">${escapeHtml(model.desc)}</div>
                    ${isSelected ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="' + color + '" viewBox="0 0 256 256"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>' : ''}
                </div>`
        }
        html += `</div>`
    }
    if (current) {
        html += `<div class="model-picker-option model-picker-reset" data-claw-id="${escapeHtml(clawId)}" data-provider-id="" data-model-id="">
            <div class="model-picker-option-name" style="color: var(--text-muted)">${I18n.t('ui.resetToDefault')}</div>
        </div>`
    }
    return html
}

function buildSyncButtonHTML(claw, status) {
    if (status !== 'running') return ''
    const effective = getEffectiveClawModel(claw.id)
    if (!effective) return ''
    const isSyncing = syncingClawIds[claw.id]
    return `
        <div class="sync-ai-btn ${isSyncing ? 'syncing' : ''}" data-action="sync-claw-ai" data-claw-id="${escapeHtml(claw.id)}">
            ${isSyncing
            ? '<div class="spinner" style="width:14px;height:14px;border-width:1.5px"></div>'
            : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="var(--accent)" viewBox="0 0 256 256"><path d="M248,128a87.34,87.34,0,0,1-17.6,52.81,8,8,0,1,1-12.8-9.62A71.34,71.34,0,0,0,232,128a72,72,0,0,0-144,0,8,8,0,0,1-16,0,88,88,0,0,1,176,0ZM166.59,151.41a8,8,0,0,0-11.31,0L136,170.73V80a8,8,0,0,0-16,0v90.73l-19.28-19.32a8,8,0,0,0-11.31,11.32l32.94,33a8,8,0,0,0,11.32,0l32.94-33A8,8,0,0,0,166.59,151.41Z"/></svg>'
        }
            <span>${isSyncing ? I18n.t('ui.syncing') : I18n.t('ui.applyAiConfig')}</span>
        </div>
    `
}

function toggleClawModelPicker(clawId) {
    document.querySelectorAll('.model-picker-dropdown').forEach(d => {
        if (d.id !== `model-picker-${clawId}`) d.classList.add('hidden')
    })
    const picker = document.getElementById(`model-picker-${clawId}`)
    if (!picker) return
    picker.classList.toggle('hidden')

    if (!picker.classList.contains('hidden')) {
        picker.querySelectorAll('.model-picker-option').forEach(opt => {
            opt.addEventListener('click', async () => {
                const cId = opt.dataset.clawId
                const pId = opt.dataset.providerId
                const mId = opt.dataset.modelId
                if (pId && mId) {
                    await saveClawModelAssignment(cId, pId, mId)
                } else {
                    await removeClawModelAssignment(cId)
                }
                picker.classList.add('hidden')
                loadClaws()
            })
        })
    }
}

async function syncClawAIConfig(clawId) {
    if (syncingClawIds[clawId]) return
    syncingClawIds[clawId] = true
    loadClaws()

    try {
        const effective = getEffectiveClawModel(clawId)
        if (!effective) {
            showToast(I18n.t('toast.noModelSelected'), 'error')
            return
        }

        const providerInfo = AI_PROVIDERS.find(p => p.id === effective.provider)
        if (!providerInfo) {
            showToast(I18n.t('toast.invalidAIProvider'), 'error')
            return
        }

        const stored = await chrome.storage.local.get('ai_configs')
        const aiConfigs = stored.ai_configs || {}
        const providerConfig = aiConfigs[effective.provider] || {}
        const apiKey = providerConfig.apiKey || ''

        const envVars = {}
        if (apiKey) {
            envVars[providerInfo.envVar] = apiKey
        }

        for (const p of AI_PROVIDERS) {
            if (p.id === effective.provider) continue
            const pc = aiConfigs[p.id]
            if (pc && pc.apiKey) {
                envVars[p.envVar] = pc.apiKey
            }
        }

        const modelId = effective.model.apiModelId || effective.model.id
        const modelValue = `${providerInfo.prefix}/${modelId}`

        const success = await apiClient.updateClawAgentConfig(clawId, {
            agentId: 'main',
            model: modelValue,
            envVars: Object.keys(envVars).length > 0 ? envVars : null
        })

        if (success) {
            showToast(I18n.t('toast.aiConfigApplied'), 'success')
        } else {
            showToast(I18n.t('toast.aiConfigFailed'), 'error')
        }
    } catch (e) {
        showToast(I18n.t('toast.syncError', { msg: e.message }), 'error')
    } finally {
        delete syncingClawIds[clawId]
        loadClaws()
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast(I18n.t('toast.copiedClipboard'), 'success')
    })
}

function escapeHtml(str) {
    if (!str) return ''
    const div = document.createElement('div')
    div.textContent = String(str)
    return div.innerHTML
}

function showToast(message, type = 'info', duration = 3000) {
    const toast = document.getElementById('toast')
    toast.textContent = message
    toast.className = `toast ${type} show`
    setTimeout(() => {
        toast.classList.remove('show')
    }, duration)
}

async function handleMountStorage(clawId, btn) {
    const stored = await chrome.storage.local.get('storage_remotes')
    const remotes = stored.storage_remotes || []

    if (remotes.length === 0) {
        showToast(I18n.t('toast.noStorageRemotes'), 'info')
        switchTab('storage')
        return
    }

    if (remotes.length === 1) {
        btn.disabled = true
        btn.innerHTML = '<div class="spinner" style="width:12px;height:12px;border-width:2px"></div> ' + I18n.t('ui.mounting')
        const result = await apiClient.mountClawStorage(clawId, remotes[0].id)
        if (result) {
            showToast(I18n.t('toast.storageMounted'), 'success')
        } else {
            showToast(I18n.t('toast.storageMountFailed'), 'error')
        }
        setTimeout(loadClaws, 1000)
        return
    }

    const modal = document.createElement('div')
    modal.className = 'mount-picker-overlay'
    modal.innerHTML = `
        <div class="mount-picker">
            <div style="font-weight: 600; margin-bottom: 10px">${I18n.t('ui.selectStorageRemote')}</div>
            ${remotes.map(r => {
        const type = STORAGE_TYPES.find(t => t.id === r.type)
        return `
                    <div class="mount-picker-item" data-remote-id="${escapeHtml(r.id)}">
                        <span style="font-size: 18px">${type?.icon || '☁️'}</span>
                        <div>
                            <div style="font-weight: 500; font-size: 12px">${escapeHtml(r.name)}</div>
                            <div style="font-size: 10px; color: var(--text-muted)">${type?.name || r.type}</div>
                        </div>
                    </div>
                `
    }).join('')}
            <button class="btn btn-secondary btn-full mt-2" id="btn-cancel-mount">${I18n.t('storage.cancel')}</button>
        </div>
    `
    document.body.appendChild(modal)

    modal.querySelector('#btn-cancel-mount').addEventListener('click', () => modal.remove())
    modal.querySelectorAll('.mount-picker-item').forEach(item => {
        item.addEventListener('click', async () => {
            const remoteId = item.dataset.remoteId
            modal.remove()
            btn.disabled = true
            btn.innerHTML = '<div class="spinner" style="width:12px;height:12px;border-width:2px"></div> ' + I18n.t('ui.mounting')
            const result = await apiClient.mountClawStorage(clawId, remoteId)
            if (result) {
                showToast(I18n.t('toast.storageMounted'), 'success')
            } else {
                showToast(I18n.t('toast.storageMountFailed'), 'error')
            }
            setTimeout(loadClaws, 1000)
        })
    })
}

function setupStoragePage() {
    document.getElementById('btn-add-remote').addEventListener('click', () => showStorageModal())
    document.getElementById('btn-close-storage-modal').addEventListener('click', hideStorageModal)
    document.getElementById('btn-cancel-remote').addEventListener('click', hideStorageModal)
    document.getElementById('btn-save-remote').addEventListener('click', saveStorageRemote)

    const typeSelect = document.getElementById('storage-remote-type')
    STORAGE_TYPES.filter(t => t.visible !== false).forEach(type => {
        const opt = document.createElement('option')
        opt.value = type.id
        opt.textContent = `${type.icon} ${type.name}`
        typeSelect.appendChild(opt)
    })

    typeSelect.addEventListener('change', () => {
        renderStorageFields(typeSelect.value)
    })
}

function showStorageModal(remote = null) {
    editingRemoteId = remote?.id || null
    document.getElementById('storage-modal-title').textContent = remote ? 'Edit Storage Remote' : 'Add Storage Remote'
    document.getElementById('storage-remote-name').value = remote?.name || ''
    document.getElementById('storage-remote-type').value = remote?.type || ''
    renderStorageFields(remote?.type || '', remote?.config || {})
    document.getElementById('storage-modal').classList.remove('hidden')
    document.getElementById('btn-add-remote').classList.add('hidden')
}

function hideStorageModal() {
    editingRemoteId = null
    document.getElementById('storage-modal').classList.add('hidden')
    document.getElementById('btn-add-remote').classList.remove('hidden')
}

function renderStorageFields(typeId, values = {}) {
    const container = document.getElementById('storage-remote-fields')
    const type = STORAGE_TYPES.find(t => t.id === typeId)
    if (!type) {
        container.innerHTML = ''
        return
    }

    container.innerHTML = type.fields.map(field => `
        <div class="form-group">
            <label class="form-label">${field.label}${field.optional ? ' (optional)' : ''}</label>
            <div class="token-input-wrapper">
                ${field.multiline ? `
                    <textarea class="token-input" id="storage-field-${field.key}" placeholder="${field.hint || `Enter ${field.label.toLowerCase()}`}" rows="3" style="resize: vertical; padding-right: 12px">${escapeHtml(values[field.key] || '')}</textarea>
                ` : `
                    <input type="${field.secret ? 'password' : 'text'}" class="token-input" id="storage-field-${field.key}" placeholder="${field.hint || `Enter ${field.label.toLowerCase()}`}" value="${escapeHtml(values[field.key] || '')}">
                    ${field.secret ? `
                        <button class="token-toggle" data-action="toggle-visibility" data-target="storage-field-${field.key}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,123.97,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.29A169.47,169.47,0,0,1,24.57,128,169.47,169.47,0,0,1,48.07,97.29C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.29A169.47,169.47,0,0,1,231.43,128C223.72,141.72,184.34,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z"/></svg>
                        </button>
                    ` : ''}
                `}
            </div>
        </div>
    `).join('')
}

async function loadStorageRemotes() {
    const stored = await chrome.storage.local.get('storage_remotes')
    storageRemotes = stored.storage_remotes || []
    renderStorageRemotes()

    try {
        const cloudRemotes = await apiClient.getCloudStorageConfigs()
        if (cloudRemotes && cloudRemotes.length > 0) {
            const mergedIds = new Set(storageRemotes.map(r => r.id))
            cloudRemotes.forEach(r => {
                if (!mergedIds.has(r.id)) {
                    storageRemotes.push(r)
                }
            })
            await chrome.storage.local.set({ storage_remotes: storageRemotes })
            renderStorageRemotes()
        }
    } catch (e) {
        console.error('Error loading cloud remotes:', e)
    }
}

function renderStorageRemotes() {
    const list = document.getElementById('storage-remotes-list')
    const empty = document.getElementById('storage-empty')

    if (storageRemotes.length === 0) {
        list.innerHTML = ''
        empty.classList.remove('hidden')
        return
    }

    empty.classList.add('hidden')
    list.innerHTML = storageRemotes.map(remote => {
        const type = STORAGE_TYPES.find(t => t.id === remote.type)
        return `
            <div class="card storage-remote-card">
                <div class="storage-remote-header">
                    <div class="storage-remote-left">
                        <span style="font-size: 20px">${type?.icon || '☁️'}</span>
                        <div>
                            <div class="storage-remote-name">${escapeHtml(remote.name)}</div>
                            <div style="font-size: 10px; color: var(--text-muted)">${type?.name || remote.type}</div>
                        </div>
                    </div>
                    ${remote.isEnabled !== false ? '<span class="storage-active-badge">Active</span>' : ''}
                </div>
                <div class="storage-remote-actions">
                    <button class="btn btn-secondary btn-small" data-action="sync-remote" data-remote-id="${escapeHtml(remote.id)}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 256 256"><path d="M224,48V96a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h28.69L182.06,73.37a79.56,79.56,0,0,0-56.13-23.43h-.45A79.52,79.52,0,0,0,69.59,72.71,8,8,0,0,1,58.33,61.29,96,96,0,0,1,192.93,60.7L208,75.52V48a8,8,0,0,1,16,0Z"/></svg>
                        Sync Now
                    </button>
                    <button class="btn btn-secondary btn-small" data-action="edit-remote" data-remote-id="${escapeHtml(remote.id)}">Edit</button>
                    <button class="btn btn-danger btn-small" data-action="delete-remote" data-remote-id="${escapeHtml(remote.id)}">Delete</button>
                </div>
            </div>
        `
    }).join('')
}

async function saveStorageRemote() {
    const name = document.getElementById('storage-remote-name').value.trim()
    const type = document.getElementById('storage-remote-type').value

    if (!name || !type) {
        showToast(I18n.t('toast.fillNameAndType'), 'error')
        return
    }

    const storageType = STORAGE_TYPES.find(t => t.id === type)
    if (!storageType) return

    const config = {}
    for (const field of storageType.fields) {
        const el = document.getElementById(`storage-field-${field.key}`)
        const val = el ? el.value.trim() : ''
        if (!field.optional && !val) {
            showToast(I18n.t('toast.fillField', { field: field.label }), 'error')
            return
        }
        if (val) config[field.key] = val
    }

    const stored = await chrome.storage.local.get('storage_remotes')
    const remotes = stored.storage_remotes || []

    if (editingRemoteId) {
        const idx = remotes.findIndex(r => r.id === editingRemoteId)
        if (idx >= 0) {
            remotes[idx] = { ...remotes[idx], name, type, config }
        }
    } else {
        const id = `remote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        remotes.push({ id, name, type, config, isEnabled: true, autoSync: false })
    }

    await chrome.storage.local.set({ storage_remotes: remotes })
    storageRemotes = remotes

    const cloudData = { name, type, config }
    if (editingRemoteId) cloudData.id = editingRemoteId
    await apiClient.upsertCloudStorageConfig(cloudData)

    hideStorageModal()
    renderStorageRemotes()
    showToast(editingRemoteId ? I18n.t('toast.remoteUpdated') : I18n.t('toast.remoteAdded'), 'success')
}

function editStorageRemote(id) {
    const remote = storageRemotes.find(r => r.id === id)
    if (remote) showStorageModal(remote)
}

async function deleteStorageRemote(id) {
    if (!confirm(I18n.t('toast.confirmDeleteRemote'))) return

    const stored = await chrome.storage.local.get('storage_remotes')
    const remotes = (stored.storage_remotes || []).filter(r => r.id !== id)
    await chrome.storage.local.set({ storage_remotes: remotes })
    storageRemotes = remotes

    await apiClient.deleteCloudStorageConfig(id)
    renderStorageRemotes()
    showToast(I18n.t('toast.remoteDeleted'), 'success')
}

async function handleSyncRemote(id) {
    // Backend sync runs ON a claw, so we need a running instance to execute it.
    if (!clawsList.length) {
        clawsList = await apiClient.getClaws() || []
    }
    const running = clawsList.filter(c => c.status === 'running')
    if (running.length === 0) {
        showToast(I18n.t('toast.syncNeedsRunningClaw'), 'error')
        return
    }
    if (running.length === 1) {
        await runRemoteSync(running[0].id, id)
        return
    }
    showClawPickerForSync(running, id)
}

async function runRemoteSync(clawId, remoteId) {
    showToast(I18n.t('toast.syncing'), 'info')
    const result = await apiClient.triggerCloudSync(clawId, remoteId)
    if (result) {
        showToast(I18n.t('toast.syncStarted'), 'success')
    } else {
        showToast(I18n.t('toast.syncFailed'), 'error')
    }
}

function showClawPickerForSync(runningClaws, remoteId) {
    document.getElementById('claw-sync-picker')?.remove()

    const overlay = document.createElement('div')
    overlay.id = 'claw-sync-picker'
    overlay.className = 'storage-modal'

    const header = document.createElement('div')
    header.className = 'storage-modal-header'
    const title = document.createElement('span')
    title.style.fontWeight = '600'
    title.textContent = I18n.t('storage.pickClawTitle')
    const closeBtn = document.createElement('button')
    closeBtn.className = 'icon-btn'
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', () => overlay.remove())
    header.appendChild(title)
    header.appendChild(closeBtn)
    overlay.appendChild(header)

    runningClaws.forEach(claw => {
        const btn = document.createElement('button')
        btn.className = 'btn btn-secondary'
        btn.style.cssText = 'display:block;width:100%;margin-top:8px;text-align:left'
        btn.textContent = claw.name || claw.id
        btn.addEventListener('click', () => {
            overlay.remove()
            runRemoteSync(claw.id, remoteId)
        })
        overlay.appendChild(btn)
    })

    const anchor = document.getElementById('storage-modal')?.parentElement || document.body
    anchor.appendChild(overlay)
}
