/**
 * The translation tables against each other and against the code that reads them.
 *
 * en and zh are the two complete tables; every other language is en with a handful of
 * overrides. A key present in en but not in zh is a Chinese UI with an English string in it;
 * a key referenced from HTML or JS but absent from en is a UI showing the raw key.
 *
 *   node --test test/i18n-parity.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { loadScripts, read, listFiles } from './helpers/load.mjs'

/**
 * How many en keys zh may still lack. The Chinese table is being completed in parallel; drop
 * this to 0 once it lands so the two can never drift apart again.
 */
const ZH_MISSING_ALLOWANCE = 5

const source = read('js/i18n.js')

/**
 * The object literal assigned to `const <name> = {` in i18n.js, evaluated on its own. Braces
 * are counted with strings and comments skipped, so a `}` inside a translation is not a
 * closing brace.
 */
function objectLiteral(name) {
    const marker = `const ${name} = {`
    const start = source.indexOf(marker)
    assert.notEqual(start, -1, `js/i18n.js no longer has "${marker}"`)
    const open = start + marker.length - 1
    let depth = 0
    let quote = null
    for (let i = open; i < source.length; i++) {
        const c = source[i]
        const next = source[i + 1]
        if (quote) {
            if (c === '\\') { i++; continue }
            if (c === quote) quote = null
            continue
        }
        if (c === '/' && next === '/') { i = source.indexOf('\n', i); continue }
        if (c === '/' && next === '*') { i = source.indexOf('*/', i) + 1; continue }
        if (c === "'" || c === '"' || c === '`') { quote = c; continue }
        if (c === '{') depth++
        else if (c === '}' && --depth === 0) {
            return vm.runInNewContext(`(${source.slice(open, i + 1)})`)
        }
    }
    assert.fail(`unbalanced braces after "${marker}"`)
}

const translations = objectLiteral('translations')
const localizedOverrides = objectLiteral('localizedOverrides')
const en = translations.en
const zh = translations.zh
const placeholders = (s) => [...String(s).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m => m[1]).sort()

test('the two full tables are en and zh, and both are large', () => {
    assert.deepEqual(Object.keys(translations).sort(), ['en', 'zh'])
    assert.ok(Object.keys(en).length > 300, `en has ${Object.keys(en).length} keys`)
    assert.ok(Object.keys(zh).length > 300, `zh has ${Object.keys(zh).length} keys`)
})

test('zh has no keys that en lacks', () => {
    const extra = Object.keys(zh).filter(k => !(k in en))
    assert.deepEqual(extra, [], `zh keys missing from en: ${extra.join(', ')}`)
})

test(`zh lacks at most ${ZH_MISSING_ALLOWANCE} en keys (aim: 0)`, () => {
    const missing = Object.keys(en).filter(k => !(k in zh))
    if (missing.length) {
        console.warn(`zh is missing ${missing.length} key(s) still shown in English:\n  ${missing.join('\n  ')}`)
    }
    assert.ok(missing.length <= ZH_MISSING_ALLOWANCE,
        `zh is missing ${missing.length} keys (allowance ${ZH_MISSING_ALLOWANCE}): ${missing.join(', ')}`)
})

test('every en string is a non-empty string and no two keys differ only by whitespace', () => {
    for (const [key, value] of Object.entries(en)) {
        assert.equal(typeof value, 'string', key)
        assert.equal(key, key.trim(), `key has surrounding whitespace: "${key}"`)
    }
})

test('en and zh interpolate the same {placeholders} for every shared key', () => {
    const drift = []
    for (const key of Object.keys(en)) {
        if (!(key in zh)) continue
        const a = placeholders(en[key])
        const b = placeholders(zh[key])
        if (a.join() !== b.join()) drift.push(`${key}: en {${a}} vs zh {${b}}`)
    }
    assert.deepEqual(drift, [])
})

test('every override for a partial language names a key that exists in en', () => {
    const problems = []
    for (const [lang, overrides] of Object.entries(localizedOverrides)) {
        for (const [key, value] of Object.entries(overrides)) {
            if (!(key in en)) problems.push(`${lang}: ${key} is not an en key`)
            else if (placeholders(value).join() !== placeholders(en[key]).join()) {
                problems.push(`${lang}: ${key} interpolates {${placeholders(value)}}, en has {${placeholders(en[key])}}`)
            }
        }
    }
    assert.deepEqual(problems, [])
})

/** Keys referenced from the pages. `data-i18n-prompt` is applied too, so it is checked too. */
function keysReferencedInHtml() {
    const refs = new Map()
    const files = listFiles('.', '.html')
    for (const file of files) {
        const html = read(file)
        for (const m of html.matchAll(/data-i18n(?:-title|-placeholder|-aria-label|-prompt)?="([^"]+)"/g)) {
            if (!refs.has(m[1])) refs.set(m[1], new Set())
            refs.get(m[1]).add(file)
        }
    }
    return refs
}

/**
 * Keys referenced from scripts as `I18n.t('...')` with a literal first argument. Only that
 * exact call shape counts: `t(` alone would also match the tail of `_sendRequest(` and the
 * like. The service worker wraps I18n.t in a local `t()`, so its bare calls count as well.
 */
function keysReferencedInJs() {
    const refs = new Map()
    const files = [...listFiles('js', '.js'), ...listFiles('pages', '.js')]
    const note = (key, file) => {
        if (!refs.has(key)) refs.set(key, new Set())
        refs.get(key).add(file)
    }
    for (const file of files) {
        const js = read(file)
        for (const m of js.matchAll(/I18n\.t\(\s*(['"])([^'"`\n]+)\1\s*[,)]/g)) note(m[2], file)
        if (file === 'js/background.js') {
            for (const m of js.matchAll(/(?<![\w$.])t\(\s*(['"])([^'"`\n]+)\1\s*[,)]/g)) note(m[2], file)
        }
    }
    return refs
}

test('every key the HTML asks for exists in en', () => {
    const refs = keysReferencedInHtml()
    assert.ok(refs.size > 50, `found only ${refs.size} data-i18n references — is the scan broken?`)
    const missing = [...refs].filter(([key]) => !(key in en)).map(([key, files]) => `${key} (${[...files].join(', ')})`)
    assert.deepEqual(missing, [])
})

test('every key a script asks for by literal exists in en', () => {
    const refs = keysReferencedInJs()
    assert.ok(refs.size > 50, `found only ${refs.size} I18n.t references — is the scan broken?`)
    const missing = [...refs].filter(([key]) => !(key in en)).map(([key, files]) => `${key} (${[...files].join(', ')})`)
    assert.deepEqual(missing, [])
})

test('the loaded module agrees with the tables and interpolates', () => {
    const { run } = loadScripts(['js/i18n.js'])
    assert.equal(run(`I18n.t('agent.step', { current: 2, total: 5 })`), en['agent.step'].replace('{current}', '2').replace('{total}', '5'))
    assert.equal(run(`I18n.t('no.such.key')`), 'no.such.key', 'a missing key comes back as itself')
    run(`I18n.setLang('zh')`)
    assert.equal(run(`I18n.getLang()`), 'zh')
    assert.equal(run(`I18n.t('tab.chat')`), zh['tab.chat'])
    run(`I18n.setLang('en')`)
    assert.equal(run(`I18n.t('tab.chat')`), en['tab.chat'])
})

test('every language offered in the picker can be selected and falls back to en', () => {
    const { run } = loadScripts(['js/i18n.js'])
    const codes = run('I18n.getAvailableLanguages()').map(l => l.code)
    assert.ok(codes.includes('en') && codes.includes('zh'))
    assert.equal(new Set(codes).size, codes.length, 'no language is listed twice')
    for (const code of codes) {
        run(`I18n.setLang(${JSON.stringify(code)})`)
        assert.equal(run('I18n.getLang()'), code, `${code} cannot be selected`)
        assert.equal(run(`I18n.t('tab.chat')`) === 'tab.chat', false, `${code} shows a raw key`)
    }
})
