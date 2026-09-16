const BROWSER_AUTOMATION_SKILL = `# Browser Automation

IMPORTANT: You are connected to a Chrome extension that controls the browser. Do NOT use any built-in browser tool (e.g. the "browser" tool). It is unavailable in this session. Instead, output JSON instructions inside \\\`\\\`\\\`action code blocks as described below. The Chrome extension will execute them and return results.

## Action Format

\\\`\\\`\\\`action
{"type": "action_type", ...params}
\\\`\\\`\\\`

You can output multiple action blocks in one response. They execute sequentially.

## Available Actions

### Navigation
- \`{"type": "navigate", "url": "https://..."}\` — Go to URL in current tab
- \`{"type": "new_tab", "url": "https://..."}\` — Open URL in new tab
- \`{"type": "select_tab", "targetTabId": 123}\` — Switch to a tab by ID
- \`{"type": "list_tabs"}\` — List all open tabs

### Interaction (by ref number)
Page elements are labeled with [ref] numbers. Use these to interact:
- \`{"type": "click_ref", "ref": 5}\` — Click element [5]
- \`{"type": "type_ref", "ref": 5, "text": "hello"}\` — Type into element [5]
- \`{"type": "hover_ref", "ref": 5}\` — Hover over element [5]

### Interaction (by CSS selector)
- \`{"type": "click", "selector": "#btn"}\` — Click element matching CSS selector
- \`{"type": "type", "selector": "#input", "text": "hello"}\` — Type into element

### Keyboard & Mouse (CDP)
- \`{"type": "cdp_key", "key": "Enter"}\` — Press a keyboard key
- \`{"type": "cdp_click", "x": 100, "y": 200}\` — Click at coordinates

### Page Content
- \`{"type": "read_page_content"}\` — Get interactive elements with ref numbers
- \`{"type": "get_page_text"}\` — Get full page text
- \`{"type": "screenshot"}\` — Capture current page screenshot

### Utility
- \`{"type": "scroll", "direction": "down", "amount": 300}\` — Scroll (up/down/left/right)
- \`{"type": "wait", "duration": 1000}\` — Wait milliseconds
- \`{"type": "execute_js", "code": "document.title"}\` — Execute JavaScript on page

## Guidelines

1. When page elements have [ref] numbers, prefer ref-based actions over CSS selectors.
2. After performing actions, you'll receive updated page state. Check whether the goal is achieved before continuing.
3. If an action fails, analyze the error and try a different approach — don't repeat the same failed action.
4. When a page hasn't loaded yet, use wait before interacting.
5. For multi-step tasks, do one or two actions at a time, then verify results.
6. If you determine the task is complete, respond with a text summary — no more actions needed.
7. NEVER use the built-in "browser" tool. Always use action blocks for browser control.
`

const SKILL_NAME = 'browser-automation'
const STORAGE_KEY = 'skillInstalledClaws'
const SKILL_VERSION = 8

class SkillInstaller {
    constructor(apiClient) {
        this._apiClient = apiClient
        this._installedClaws = new Map()
        this._loadState()
    }

    _loadState() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY)
            if (stored) {
                const parsed = JSON.parse(stored)
                if (Array.isArray(parsed)) {
                    this._installedClaws = new Map()
                } else if (parsed && typeof parsed === 'object') {
                    this._installedClaws = new Map(Object.entries(parsed))
                }
            }
        } catch (_) { }
    }

    _saveState() {
        try {
            const obj = Object.fromEntries(this._installedClaws)
            localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
        } catch (_) { }
    }

    async ensureSkillInstalled(clawId) {
        if (this._installedClaws.get(clawId) === SKILL_VERSION) return true

        if (this._installing) {
            return new Promise(resolve => {
                const check = setInterval(() => {
                    if (!this._installing) {
                        clearInterval(check)
                        resolve(this._installedClaws.get(clawId) === SKILL_VERSION)
                    }
                }, 500)
            })
        }

        this._installing = true
        try {
            console.log('[SkillInstaller] Syncing browser-automation skill content...')
            const installed = await this._apiClient.installAgentSkill(clawId, 'main', SKILL_NAME, BROWSER_AUTOMATION_SKILL)
            if (!installed) {
                console.error('[SkillInstaller] Failed to sync skill content')
                return false
            }

            console.log('[SkillInstaller] Verifying SKILL.md on server...')
            const skillPath = `agents/main/workspace/skills/${SKILL_NAME}/SKILL.md`
            const content = await this._apiClient.readClawFile(clawId, skillPath)
            if (content && content.includes('Browser Automation')) {
                console.log('[SkillInstaller] SKILL.md synced on server (%d chars)', content.length)
            } else {
                console.warn('[SkillInstaller] SKILL.md verification failed. Content:', content ? content.substring(0, 100) : 'null')
            }

            const config = await this._apiClient.readClawFile(clawId, 'openclaw.json')
            if (config) {
                try {
                    const parsed = JSON.parse(config)
                    const agents = parsed.agents || {}
                    const mainAgent = agents.main || {}
                    const skillEntries = mainAgent.skillEntries || parsed.skillEntries || {}
                    console.log('[SkillInstaller] openclaw.json skillEntries:', JSON.stringify(skillEntries))
                } catch (e) {
                    console.log('[SkillInstaller] openclaw.json raw (first 300 chars):', config.substring(0, 300))
                }
            } else {
                console.warn('[SkillInstaller] Could not read openclaw.json')
            }

            this._installedClaws.set(clawId, SKILL_VERSION)
            this._saveState()
            console.log('[SkillInstaller] Skill sync complete')
            return true
        } catch (e) {
            console.error('[SkillInstaller] Failed to sync browser-automation skill:', e)
            return false
        } finally {
            this._installing = false
        }
    }

    isInstalled(clawId) {
        return this._installedClaws.get(clawId) === SKILL_VERSION
    }

    clearCache() {
        this._installedClaws.clear()
        this._saveState()
    }
}
