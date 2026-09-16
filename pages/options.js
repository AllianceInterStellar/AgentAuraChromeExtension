let currentMode = 'ask'

document.addEventListener('DOMContentLoaded', async () => {
    await I18n.init()
    I18n.applyToPage()

    const langSelect = document.getElementById('setting-language')
    if (langSelect) {
        langSelect.value = I18n.getLang()
        langSelect.addEventListener('change', async () => {
            I18n.setLang(langSelect.value)
            I18n.applyToPage()
            await loadSettings()
        })
    }

    loadSettings()
})

document.querySelectorAll('.perm-mode').forEach(el => {
    el.addEventListener('click', () => {
        document.querySelectorAll('.perm-mode').forEach(m => m.classList.remove('active'))
        el.classList.add('active')
        currentMode = el.dataset.mode
    })
})

document.getElementById('btn-save').addEventListener('click', saveSettings)

async function loadSettings() {
    const stored = await chrome.storage.local.get([
        'agent_permission_mode',
        'agent_settings',
        'agent_shortcuts',
        'agent_scheduled_tasks',
        'dev_api_url'
    ])

    currentMode = stored.agent_permission_mode || 'ask'
    document.querySelectorAll('.perm-mode').forEach(m => {
        m.classList.toggle('active', m.dataset.mode === currentMode)
    })

    const settings = stored.agent_settings || {}
    document.getElementById('setting-blocked-sites').checked = settings.blockedSitesEnabled !== false
    document.getElementById('setting-tab-group').checked = settings.tabGroupEnabled !== false
    document.getElementById('setting-max-steps').value = settings.maxSteps || 50
    document.getElementById('setting-screenshot-quality').value = settings.screenshotQuality || 80

    const apiUrlInput = document.getElementById('setting-api-url')
    if (apiUrlInput) apiUrlInput.value = stored.dev_api_url || ''

    renderShortcuts(stored.agent_shortcuts || [])
    renderTasks(stored.agent_scheduled_tasks || [])
}

async function saveSettings() {
    const apiUrlInput = document.getElementById('setting-api-url')
    const apiUrl = apiUrlInput ? apiUrlInput.value.trim() : ''

    const toSet = {
        agent_permission_mode: currentMode,
        agent_settings: {
            blockedSitesEnabled: document.getElementById('setting-blocked-sites').checked,
            tabGroupEnabled: document.getElementById('setting-tab-group').checked,
            maxSteps: parseInt(document.getElementById('setting-max-steps').value) || 50,
            screenshotQuality: parseInt(document.getElementById('setting-screenshot-quality').value) || 80
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
            <span class="shortcut-uses">${s.uses} ${I18n.t('options.uses')}</span>
            <button class="delete-btn" data-id="${s.id}">${I18n.t('sys.delete')}</button>
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
                <div class="task-schedule">${I18n.t('sys.everyNMin', { n: t.intervalMinutes })} · ${t.runCount || 0} ${I18n.t('options.runs')} · ${t.enabled ? '✅ ' + I18n.t('options.active') : '⏸ ' + I18n.t('options.paused')}</div>
            </div>
            <button class="delete-btn" data-task-id="${t.id}" style="opacity:1">${I18n.t('sys.delete')}</button>
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

function escapeHtml(str) {
    const div = document.createElement('div')
    div.textContent = String(str || '')
    return div.innerHTML
}

function escapeAttr(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}