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
const SKILL_STORAGE_KEY = 'skill_installed_claws'
const SKILL_VERSION = 8

/**
 * Pushes the skill text above to a claw once per SKILL_VERSION. The record of what was
 * installed lives in chrome.storage.local (shared with every other page of the extension),
 * one in-flight install per claw is shared by concurrent callers, and a verification failure
 * is a failure: it is not recorded, so the next run tries again.
 */
class SkillInstaller {
    constructor(apiClient) {
        this._apiClient = apiClient
        this._installedClaws = new Map()
        this._inflight = new Map()
        this._loaded = this._loadState()
    }

    async _loadState() {
        try {
            const stored = await chrome.storage.local.get(SKILL_STORAGE_KEY)
            const parsed = stored[SKILL_STORAGE_KEY]
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                this._installedClaws = new Map(Object.entries(parsed))
            }
        } catch (_) { }
    }

    async _saveState() {
        try {
            await chrome.storage.local.set({ [SKILL_STORAGE_KEY]: Object.fromEntries(this._installedClaws) })
        } catch (_) { }
    }

    async ensureSkillInstalled(clawId) {
        await this._loaded
        if (this.isInstalled(clawId)) return true
        if (this._inflight.has(clawId)) return this._inflight.get(clawId)

        const run = this._install(clawId).finally(() => this._inflight.delete(clawId))
        this._inflight.set(clawId, run)
        return run
    }

    async _install(clawId) {
        try {
            const installed = await this._apiClient.installAgentSkill(clawId, 'main', SKILL_NAME, BROWSER_AUTOMATION_SKILL)
            if (!installed) {
                console.error('[SkillInstaller] Failed to sync skill content')
                return false
            }

            const skillPath = `agents/main/workspace/skills/${SKILL_NAME}/SKILL.md`
            const content = await this._apiClient.readClawFile(clawId, skillPath)
            if (!content || !content.includes('Browser Automation')) {
                console.warn('[SkillInstaller] SKILL.md verification failed:', content ? content.substring(0, 100) : 'null')
                return false
            }

            this._installedClaws.set(clawId, SKILL_VERSION)
            await this._saveState()
            return true
        } catch (e) {
            console.error('[SkillInstaller] Failed to sync browser-automation skill:', e)
            return false
        }
    }

    isInstalled(clawId) {
        return this._installedClaws.get(clawId) === SKILL_VERSION
    }

    async clearCache() {
        this._installedClaws.clear()
        await this._saveState()
    }
}
