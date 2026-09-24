import { chromium } from 'playwright'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(__dirname, '..')
// Defaults next to the repo so a clone produces output without configuration.
const OUT_DIR = process.env.AGENTAURA_CWS_OUT
    || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'store-assets')
const PROXY = 'http://127.0.0.1:22334'
const USER_DATA_DIR = path.join(os.tmpdir(), `agentaura-cws-assets-${Date.now()}`)

const screenshotPaths = {
    claws: path.join(OUT_DIR, '01-claws-dashboard.png'),
    deploy: path.join(OUT_DIR, '02-deploy-flow.png'),
    config: path.join(OUT_DIR, '03-provider-config.png'),
    sidepanel: path.join(OUT_DIR, '04-browser-agent-sidepanel.png'),
    options: path.join(OUT_DIR, '05-automation-settings.png')
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function detectExtensionId(context) {
    await sleep(5000)
    for (const worker of context.serviceWorkers()) {
        const url = worker.url()
        if (url.startsWith('chrome-extension://')) {
            return new URL(url).hostname
        }
    }
    const page = context.pages()[0] || await context.newPage()
    const session = await context.newCDPSession(page)
    const targets = await session.send('Target.getTargets')
    await session.detach().catch(() => { })
    for (const target of targets.targetInfos || []) {
        if (target.url?.startsWith('chrome-extension://')) {
            return new URL(target.url).hostname
        }
    }
    const prefCandidates = [
        path.join(USER_DATA_DIR, 'Default', 'Preferences'),
        path.join(USER_DATA_DIR, 'Preferences')
    ]
    for (const prefPath of prefCandidates) {
        if (!fs.existsSync(prefPath)) continue
        try {
            const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf8'))
            const settings = prefs?.extensions?.settings || {}
            for (const [extensionId, extensionData] of Object.entries(settings)) {
                const extensionPath = extensionData?.path || ''
                if (extensionPath === EXTENSION_PATH || extensionPath.startsWith(EXTENSION_PATH)) {
                    return extensionId
                }
            }
        } catch (_) { }
    }
    throw new Error('Could not detect extension ID')
}

async function seedPopupStorage(page) {
    await page.evaluate(async () => {
        await chrome.storage.local.set({
            i18n_lang: 'en',
            auth_user: {
                uid: 'demo-user',
                email: 'demo@example.com',
                displayName: 'Demo',
                providerId: 'google.com',
                isAnonymous: false
            },
            auth_id_token: 'demo-token',
            ai_configs: {
                claude: { apiKey: 'sk-ant-api03-xxxxxxxxxxxxxxxx' }
            },
            provider_configs: {
                hetzner: { apiToken: 'hetzner-demo-token-xxxxxxxx' }
            },
            storage_remotes: [
                {
                    id: 'remote-1',
                    name: 'nightly-backup',
                    type: 's3',
                    bucket: 'agentaura-backups',
                    region: 'us-east-1',
                    mountPath: '/data/backups',
                    lastSyncAt: '2026-03-23T12:00:00Z'
                }
            ],
            agent_settings: {
                blockedSitesEnabled: true,
                tabGroupEnabled: true,
                maxSteps: 50,
                screenshotQuality: 80
            },
            agent_permission_mode: 'plan',
            agent_shortcuts: [
                { id: 's1', name: 'Summarize this page', text: 'Read this page and summarize it.', uses: 24 },
                { id: 's2', name: 'Fill contact form', text: 'Fill the visible form with safe demo data.', uses: 11 }
            ],
            agent_scheduled_tasks: [
                { id: 't1', name: 'Check support inbox', intervalMinutes: 60, runCount: 12, enabled: true },
                { id: 't2', name: 'Watch pricing page', intervalMinutes: 180, runCount: 5, enabled: false }
            ]
        })
    })
}

async function preparePopupClaws(page) {
    await page.evaluate(() => {
        if (typeof showMainApp === 'function') showMainApp()
        if (typeof switchTab === 'function') switchTab('claws')

        const loading = document.getElementById('claws-loading')
        const empty = document.getElementById('claws-empty')
        const error = document.getElementById('claws-error')
        if (loading) loading.classList.add('hidden')
        if (empty) empty.classList.add('hidden')
        if (error) error.classList.add('hidden')

        const sampleClaws = [
            {
                id: 'claw-1',
                name: 'marketing-agent',
                provider: 'hetzner',
                planId: 'cx32',
                status: 'running',
                cpu: 4,
                memory: 8,
                storage: 80,
                ip: '203.0.113.10',
                subdomain: 'marketing-agent',
                storageMountEnabled: true
            },
            {
                id: 'claw-2',
                name: 'support-bot',
                provider: 'hetzner',
                planId: 'cx22',
                status: 'stopped',
                cpu: 2,
                memory: 4,
                storage: 40,
                ip: '116.203.12.44',
                subdomain: 'support-bot',
                storageMountEnabled: false
            }
        ]

        if (typeof renderClawsList === 'function') {
            renderClawsList(sampleClaws)
        }
    })
}

async function preparePopupDeploy(page) {
    await page.evaluate(() => {
        if (typeof showMainApp === 'function') showMainApp()
        if (typeof switchTab === 'function') switchTab('deploy')
        selectedProvider = 'hetzner'
        selectedAIProvider = 'claude'
        selectedAIModel = 'claude-sonnet-4.6'
        if (typeof renderProviderGrid === 'function') renderProviderGrid()
        if (typeof renderAIProviderGrid === 'function') renderAIProviderGrid()
        if (typeof renderAIModelSelect === 'function') renderAIModelSelect()
        if (typeof renderDefaultPlans === 'function') renderDefaultPlans('hetzner')
        const nameInput = document.getElementById('deploy-name')
        if (nameInput) nameInput.value = 'agentaura-demo'
        const regionSelect = document.getElementById('deploy-region')
        if (typeof renderDefaultRegions === 'function' && regionSelect) renderDefaultRegions('hetzner', regionSelect)
        selectedPlan = 'cx32'
        document.querySelectorAll('.plan-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.planId === 'cx32')
        })
        if (regionSelect) regionSelect.value = 'fsn1'
        if (typeof updateDeployButton === 'function') updateDeployButton()
    })
}

async function preparePopupConfig(page) {
    await seedPopupStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await sleep(1200)
    await page.evaluate(async () => {
        if (typeof I18n !== 'undefined') { I18n.setLang('en'); if (typeof refreshLocalizedUI === 'function') await refreshLocalizedUI(); I18n.applyToPage() }
    })
    await sleep(500)
    await page.evaluate(async () => {
        if (typeof showMainApp === 'function') showMainApp()
        if (typeof switchTab === 'function') switchTab('config')
        if (typeof renderConfigProviders === 'function') renderConfigProviders()
        if (typeof renderAIConfigProviders === 'function') renderAIConfigProviders()
        if (typeof loadSavedConfigs === 'function') await loadSavedConfigs()
        if (typeof loadSavedAIConfigs === 'function') await loadSavedAIConfigs()
        document.querySelector('[data-config-provider="ai-claude"]')?.classList.add('expanded')
        document.getElementById('config-body-ai-claude')?.classList.add('expanded')
        document.querySelector('[data-config-provider="hetzner"]')?.classList.add('expanded')
        document.getElementById('config-body-hetzner')?.classList.add('expanded')
    })
}

async function prepareSidepanel(page) {
    await page.evaluate(() => {
        const empty = document.getElementById('sp-empty-state')
        if (empty) empty.remove()
        const messages = document.getElementById('sp-messages')
        messages.innerHTML = `
            <div class="sp-message sp-message-user"><div class="sp-message-bubble">Open the current page, extract the key points, and prepare a reply draft.</div></div>
            <div class="sp-message sp-message-assistant"><div class="sp-message-bubble">Plan approved. I inspected the current tab, summarized the main issues, and drafted a concise response. I can also fill the support form or export the result.</div></div>
        `
        document.getElementById('sp-agent-banner')?.classList.remove('hidden')
        document.getElementById('sp-step-current').textContent = '3'
        document.getElementById('sp-step-total').textContent = '4'
        const clawSelect = document.getElementById('sp-claw-select')
        if (clawSelect) clawSelect.innerHTML = '<option value="marketing-agent" selected>marketing-agent</option>'
        document.querySelector('.sp-perm-btn.active')?.classList.remove('active')
        document.querySelector('.sp-perm-btn[data-mode="plan"]')?.classList.add('active')
    })
}

async function prepareOptions(page) {
    await page.evaluate(async () => {
        await chrome.storage.local.set({
            i18n_lang: 'en',
            agent_permission_mode: 'plan',
            agent_settings: {
                blockedSitesEnabled: true,
                tabGroupEnabled: true,
                maxSteps: 75,
                screenshotQuality: 85
            },
            agent_shortcuts: [
                { id: 's1', name: 'Summarize this page', text: 'Read and summarize the visible page.', uses: 28 },
                { id: 's2', name: 'Check invoices', text: 'Open billing and list unpaid invoices.', uses: 9 }
            ],
            agent_scheduled_tasks: [
                { id: 't1', name: 'Check support inbox', intervalMinutes: 60, runCount: 12, enabled: true },
                { id: 't2', name: 'Monitor cloud prices', intervalMinutes: 180, runCount: 5, enabled: false }
            ],
            dev_api_url: 'https://awsapi.allianceinterstellar.com'
        })
        if (typeof loadSettings === 'function') await loadSettings()
    })
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        locale: 'en-US',
        viewport: { width: 1280, height: 800 },
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-first-run',
            '--no-default-browser-check',
            `--proxy-server=${PROXY}`,
            '--lang=en-US',
            '--accept-lang=en-US,en'
        ]
    })

    try {
        const extensionId = await detectExtensionId(context)

        const popup = await context.newPage()
        await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' })
        await sleep(1500)
        await seedPopupStorage(popup)
        await popup.reload({ waitUntil: 'domcontentloaded' })
        await sleep(1500)
        await popup.evaluate(async () => {
            if (typeof I18n !== 'undefined') { I18n.setLang('en'); if (typeof refreshLocalizedUI === 'function') await refreshLocalizedUI(); I18n.applyToPage() }
        })
        await sleep(800)

        await preparePopupClaws(popup)
        await popup.evaluate(() => { if (typeof I18n !== 'undefined') I18n.applyToPage() })
        await sleep(800)
        await popup.screenshot({ path: screenshotPaths.claws })

        await preparePopupDeploy(popup)
        await popup.evaluate(() => { if (typeof I18n !== 'undefined') I18n.applyToPage() })
        await sleep(800)
        await popup.screenshot({ path: screenshotPaths.deploy })

        await preparePopupConfig(popup)
        await popup.evaluate(() => { if (typeof I18n !== 'undefined') I18n.applyToPage() })
        await sleep(1000)
        await popup.screenshot({ path: screenshotPaths.config })

        const sidepanel = await context.newPage()
        await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
        await sleep(1500)
        await sidepanel.evaluate(async () => {
            if (typeof I18n !== 'undefined') { I18n.setLang('en'); if (typeof refreshLocalizedUI === 'function') await refreshLocalizedUI(); I18n.applyToPage() }
        })
        await sleep(800)
        await prepareSidepanel(sidepanel)
        await sidepanel.evaluate(() => { if (typeof I18n !== 'undefined') I18n.applyToPage() })
        await sleep(800)
        await sidepanel.screenshot({ path: screenshotPaths.sidepanel })

        const options = await context.newPage()
        await options.goto(`chrome-extension://${extensionId}/pages/options.html`, { waitUntil: 'domcontentloaded' })
        await sleep(1200)
        await options.evaluate(async () => {
            if (typeof I18n !== 'undefined') { I18n.setLang('en'); if (typeof refreshLocalizedUI === 'function') await refreshLocalizedUI(); I18n.applyToPage() }
        })
        await sleep(800)
        await prepareOptions(options)
        await options.evaluate(() => { if (typeof I18n !== 'undefined') I18n.applyToPage() })
        await sleep(1000)
        await options.screenshot({ path: screenshotPaths.options })

        console.log('Generated screenshots:')
        Object.values(screenshotPaths).forEach(file => console.log(file))
    } finally {
        await context.close()
        fs.rmSync(USER_DATA_DIR, { recursive: true, force: true })
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
