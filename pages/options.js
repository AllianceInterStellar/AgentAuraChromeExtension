let currentMode = 'ask'

document.addEventListener('DOMContentLoaded', async () => {
    await I18n.init()
    I18n.applyToPage()
    document.documentElement.lang = I18n.getLang()

    const langSelect = document.getElementById('setting-language')
    if (langSelect) {
        langSelect.value = I18n.getLang()
        langSelect.addEventListener('change', async () => {
            I18n.setLang(langSelect.value)
            I18n.applyToPage()
            document.documentElement.lang = I18n.getLang()
            await loadSettings()
        })
    }

    loadSettings()
})

/** Modes the organization allows; empty when nothing is managed. */
let allowedModes = []

document.querySelectorAll('.perm-mode').forEach(el => {
    el.addEventListener('click', () => {
        if (allowedModes.length && !allowedModes.includes(el.dataset.mode)) return
        document.querySelectorAll('.perm-mode').forEach(m => m.classList.remove('active'))
        el.classList.add('active')
        currentMode = el.dataset.mode
    })
})

/** The administrator's policy, shown as a notice and as greyed-out choices. */
async function loadPolicy() {
    let policy = null
    let managed = false
    try {
        const res = await chrome.runtime.sendMessage({ type: 'GET_POLICY' })
        if (res && res.policy) { policy = res.policy; managed = !!res.managed }
    } catch (_) { }
    allowedModes = policy ? policy.AllowedPermissionModes : []
    const notice = document.getElementById('managed-notice')
    if (notice) notice.classList.toggle('hidden', !managed)
    document.querySelectorAll('.perm-mode').forEach(m => {
        const allowed = !allowedModes.length || allowedModes.includes(m.dataset.mode)
        m.classList.toggle('managed', !allowed)
        m.title = allowed ? '' : I18n.t('perm.managed')
    })
    if (allowedModes.length && !allowedModes.includes(currentMode)) {
        currentMode = allowedModes.includes('ask') ? 'ask' : allowedModes[0]
        document.querySelectorAll('.perm-mode').forEach(m => m.classList.toggle('active', m.dataset.mode === currentMode))
    }
    const tasksSection = document.getElementById('tasks-section')
    if (tasksSection) tasksSection.classList.toggle('managed-off', !!(policy && policy.DisableScheduledTasks))
}

document.getElementById('btn-save').addEventListener('click', saveSettings)

async function loadSettings() {
    const stored = await chrome.storage.local.get([
        'agent_permission_mode',
        'agent_settings',
        'agent_shortcuts',
        'agent_scheduled_tasks',
        'agent_site_allow',
        'dev_api_url'
    ])

    currentMode = stored.agent_permission_mode || 'ask'
    document.querySelectorAll('.perm-mode').forEach(m => {
        m.classList.toggle('active', m.dataset.mode === currentMode)
    })

    const settings = stored.agent_settings || {}
    document.getElementById('setting-blocked-sites').checked = settings.blockedSitesEnabled !== false
    document.getElementById('setting-tab-group').checked = settings.tabGroupEnabled !== false
    document.getElementById('setting-screenshot-every-turn').checked = settings.screenshotEveryTurn === true
    document.getElementById('setting-financial-confirm').checked = settings.financialConfirmEnabled !== false
    document.getElementById('setting-persist-chat').checked = settings.persistChatHistory !== false
    document.getElementById('setting-extra-blocked').value = hostList(settings.extraBlockedHosts).join('\n')
    document.getElementById('setting-allowed-hosts').value = hostList(settings.allowedHosts).join('\n')
    document.getElementById('setting-max-steps').value = settings.maxSteps || 50
    document.getElementById('setting-screenshot-quality').value = settings.screenshotQuality || 80

    const apiUrlInput = document.getElementById('setting-api-url')
    if (apiUrlInput) apiUrlInput.value = stored.dev_api_url || ''

    renderShortcuts(stored.agent_shortcuts || [])
    renderTasks(stored.agent_scheduled_tasks || [])
    renderAllowedSites(stored.agent_site_allow || [])
    await loadPolicy()
}

/** Hostnames, one per line or comma-separated, lower-cased, without scheme or path, deduplicated. */
function hostList(value) {
    const raw = Array.isArray(value) ? value : String(value || '').split(/[\n,]/)
    const out = []
    for (const item of raw) {
        const host = String(item || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
        if (host && /^[a-z0-9.-]+$/.test(host) && !out.includes(host)) out.push(host)
    }
    return out
}

async function saveSettings() {
    const apiUrlInput = document.getElementById('setting-api-url')
    const apiUrl = apiUrlInput ? apiUrlInput.value.trim() : ''

    const maxSteps = parseInt(document.getElementById('setting-max-steps').value, 10)
    const quality = parseInt(document.getElementById('setting-screenshot-quality').value, 10)
    const toSet = {
        agent_permission_mode: currentMode,
        agent_settings: {
            blockedSitesEnabled: document.getElementById('setting-blocked-sites').checked,
            tabGroupEnabled: document.getElementById('setting-tab-group').checked,
            screenshotEveryTurn: document.getElementById('setting-screenshot-every-turn').checked,
            financialConfirmEnabled: document.getElementById('setting-financial-confirm').checked,
            persistChatHistory: document.getElementById('setting-persist-chat').checked,
            extraBlockedHosts: hostList(document.getElementById('setting-extra-blocked').value),
            allowedHosts: hostList(document.getElementById('setting-allowed-hosts').value),
            maxSteps: Number.isFinite(maxSteps) ? clamp(maxSteps, 1, 500) : 50,
            screenshotQuality: Number.isFinite(quality) ? clamp(quality, 10, 100) : 80
        }
    }

    if (apiUrl) toSet.dev_api_url = apiUrl
    else await chrome.storage.local.remove('dev_api_url')

    await chrome.storage.local.set(toSet)

    const btn = document.getElementById('btn-save')
    btn.textContent = I18n.t('options.saved')
    setTimeout(() => { btn.textContent = I18n.t('options.save') }, 1500)
}

function renderShortcuts(shortcuts) {
    const list = document.getElementById('shortcuts-list')
    if (shortcuts.length === 0) {
        list.innerHTML = '<div style="color: var(--text3); font-size: 12px; text-align: center; padding: 20px;">' + I18n.t('options.noShortcuts') + '</div>'
        return
    }
    list.innerHTML = shortcuts.map(s => `
        <div class="shortcut-item">
            <span class="shortcut-text" title="${escapeAttr(s.text)}">${escapeHtml(s.name)}</span>
            <span class="shortcut-uses">${toNumber(s.uses)} ${escapeHtml(I18n.t('options.uses'))}</span>
            <button class="delete-btn" data-id="${escapeAttr(s.id)}">${escapeHtml(I18n.t('sys.delete'))}</button>
        </div>
    `).join('')

    list.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id
            const stored = await chrome.storage.local.get('agent_shortcuts')
            const updated = (stored.agent_shortcuts || []).filter(s => s.id !== id)
            await chrome.storage.local.set({ agent_shortcuts: updated })
            renderShortcuts(updated)
        })
    })
}

function renderTasks(tasks) {
    const list = document.getElementById('tasks-list')
    if (tasks.length === 0) {
        list.innerHTML = '<div style="color: var(--text3); font-size: 12px; text-align: center; padding: 20px;">' + I18n.t('options.noTasks') + '</div>'
        return
    }
    list.innerHTML = tasks.map(t => `
        <div class="task-item">
            <div class="task-info">
                <div class="task-name">${escapeHtml(t.name)}</div>
                <div class="task-schedule">${escapeHtml(TaskScheduler.describeSchedule(t, I18n.getLang()))} · ${toNumber(t.runCount)} ${escapeHtml(I18n.t('options.runs'))} · ${t.enabled ? '✅ ' + escapeHtml(I18n.t('options.active')) : '⏸ ' + escapeHtml(I18n.t('options.paused'))}${Array.isArray(t.runs) && t.runs[0] ? ' · ' + escapeHtml(I18n.t('schedule.lastRunLine', { when: new Date(t.runs[0].finishedAt || t.runs[0].startedAt).toLocaleString(I18n.getLang() === 'zh' ? 'zh-CN' : undefined), status: I18n.t(`schedule.status.${t.runs[0].status}`), steps: toNumber(t.runs[0].steps) })) : ''}</div>
            </div>
            <button class="delete-btn" data-task-id="${escapeAttr(t.id)}" style="opacity:1">${escapeHtml(I18n.t('sys.delete'))}</button>
        </div>
    `).join('')

    list.querySelectorAll('[data-task-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.taskId
            const stored = await chrome.storage.local.get('agent_scheduled_tasks')
            const updated = (stored.agent_scheduled_tasks || []).filter(t => t.id !== id)
            await chrome.storage.local.set({ agent_scheduled_tasks: updated })
            await chrome.alarms.clear('scheduled_task_' + id)
            renderTasks(updated)
        })
    })
}

function renderAllowedSites(sites) {
    const list = document.getElementById('site-allow-list')
    if (!list) return
    if (!sites.length) {
        list.innerHTML = '<div style="color: var(--text3); font-size: 12px; text-align: center; padding: 20px;">' + escapeHtml(I18n.t('options.noSites')) + '</div>'
        return
    }
    list.innerHTML = sites.map(site => `
        <div class="shortcut-item">
            <span class="shortcut-text">${escapeHtml(site)}</span>
            <button class="delete-btn" data-site="${escapeAttr(site)}" style="opacity:1">${escapeHtml(I18n.t('options.remove'))}</button>
        </div>
    `).join('')

    list.querySelectorAll('[data-site]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const stored = await chrome.storage.local.get('agent_site_allow')
            const updated = (stored.agent_site_allow || []).filter(s => s !== btn.dataset.site)
            await chrome.storage.local.set({ agent_site_allow: updated })
            renderAllowedSites(updated)
        })
    })
}
