/**
 * js/chat.js, the two pure parts: parseMessageContent turns whatever shape the gateway sends
 * into {text, images}; renderMarkdown turns model text into HTML that cannot carry script.
 *
 *   node --test test/chat-parse.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadScripts, plain } from './helpers/load.mjs'

// chat.js needs escapeHtml/sanitizeUrl (utils) and I18n at call time; nothing at load time
// touches the network or the DOM.
const { run } = loadScripts(['js/utils.js', 'js/i18n.js', 'js/chat.js'])
const parseMessageContent = run('parseMessageContent')
const renderMarkdown = run('renderMarkdown')
const parse = (message) => plain(parseMessageContent(message))

const empty = { text: '', images: [] }
const png = { mimeType: 'image/png', base64Data: 'AAA=' }

const cases = [
    ['a plain string', 'hello', { text: 'hello', images: [] }],
    ['null', null, empty],
    ['undefined', undefined, empty],
    ['a number', 42, empty],
    ['a boolean', true, empty],
    ['{content: string}', { content: 'x' }, { text: 'x', images: [] }],
    ['{content} nested twice', { content: { content: [{ type: 'text', text: 'deep' }] } }, { text: 'deep', images: [] }],
    ['{text}', { text: 'plain' }, { text: 'plain', images: [] }],
    ['{text} that is not a string', { text: 5 }, empty],
    ['an object with nothing useful', { role: 'assistant' }, empty],
    ['{content: null} falls through to {text}', { content: null, text: 'fallback' }, { text: 'fallback', images: [] }],
    ['an empty array', [], empty],
    ['strings and text blocks concatenate', ['a', { type: 'text', text: 'b' }, 'c'], { text: 'abc', images: [] }],
    ['a text block without text', [{ type: 'text' }], empty],
    ['unknown block types are skipped', [{ type: 'tool_use', id: 't1' }, { type: 'text', text: 'ok' }], { text: 'ok', images: [] }],
    ['null entries in the array are skipped', [null, { type: 'text', text: 'ok' }], { text: 'ok', images: [] }],
    ['image with a base64 source',
        [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA=' } }],
        { text: '', images: [{ mimeType: 'image/jpeg', base64Data: 'AAA=' }] }],
    ['image source mediaType spelling',
        [{ type: 'image', source: { mediaType: 'image/webp', data: 'AAA=' } }],
        { text: '', images: [{ mimeType: 'image/webp', base64Data: 'AAA=' }] }],
    ['image source without a type takes the block mime type, then png',
        [{ type: 'image', source: { data: 'AAA=' } }, { type: 'image', mimeType: 'image/gif', source: { data: 'BBB=' } }],
        { text: '', images: [png, { mimeType: 'image/gif', base64Data: 'BBB=' }] }],
    ['image source with a url becomes a markdown image in the text',
        [{ type: 'image', source: { url: 'https://x/y.png' } }],
        { text: '\n\n![image](https://x/y.png)\n\n', images: [] }],
    ['image with inline data', [{ type: 'image', mimeType: 'image/webp', data: 'AAA=' }],
        { text: '', images: [{ mimeType: 'image/webp', base64Data: 'AAA=' }] }],
    ['image with media_type spelling', [{ type: 'image', media_type: 'image/jpeg', data: 'AAA=' }],
        { text: '', images: [{ mimeType: 'image/jpeg', base64Data: 'AAA=' }] }],
    ['image with bytes', [{ type: 'image', bytes: 'AAA=' }], { text: '', images: [png] }],
    ['omitted bytes are not an image', [{ type: 'image', bytes: 'AAA=', omitted: true }], empty],
    ['image with a url', [{ type: 'image', url: 'https://x/z.png' }], { text: '\n\n![image](https://x/z.png)\n\n', images: [] }],
    ['data wins over url', [{ type: 'image', data: 'AAA=', url: 'https://x/z.png' }], { text: '', images: [png] }],
    ['text and image interleaved',
        [{ type: 'text', text: 'before ' }, { type: 'image', data: 'AAA=' }, { type: 'text', text: 'after' }],
        { text: 'before after', images: [png] }],
]

for (const [name, input, expected] of cases) {
    test(`parseMessageContent: ${name}`, () => {
        assert.deepEqual(parse(input), expected)
    })
}

test('renderMarkdown escapes markup instead of rendering it', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>')
    assert.doesNotMatch(html, /<script/i)
    assert.doesNotMatch(html, /<img/i)
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
})

test('renderMarkdown neutralises javascript: links', () => {
    const html = renderMarkdown('[x](javascript:alert(1))')
    assert.match(html, /<a href="#" target="_blank" rel="noopener noreferrer">x<\/a>/)
    assert.doesNotMatch(html, /javascript:/i)
    for (const bad of ['[x](JAVASCRIPT:alert(1))', '[x](data:text/html,hi)', '[x](file:///etc/passwd)', '[x](vbscript:x)']) {
        assert.match(renderMarkdown(bad), /href="#"/, bad)
    }
})

test('renderMarkdown keeps http(s) and mailto links, with the href attribute-escaped', () => {
    assert.match(renderMarkdown('[site](https://example.com/a?b=1&c=2)'),
        /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">site<\/a>/)
    assert.match(renderMarkdown('[home](http://example.com)'), /href="http:\/\/example\.com"/)
    assert.match(renderMarkdown('[mail](mailto:a@example.com)'), /href="mailto:a@example\.com"/)
})

test('renderMarkdown: a link label is escaped like any other text', () => {
    const html = renderMarkdown('[<b>x</b>](https://example.com)')
    assert.doesNotMatch(html, /<b>/)
    assert.match(html, />&lt;b&gt;x&lt;\/b&gt;<\/a>/)
})

test('renderMarkdown leaves replacement patterns inside code blocks alone', () => {
    const html = renderMarkdown('before\n```js\nconst s = "$&" + "$\'" + "$`" + "$1"\n```\nafter')
    assert.match(html, /<pre class="chat-code-block"><code>const s = &quot;\$&amp;&quot; \+ &quot;\$&#39;&quot; \+ &quot;\$`&quot; \+ &quot;\$1&quot;/)
    assert.doesNotMatch(html, /CODEBLOCK|\x00/, 'placeholders are all replaced')
    assert.equal((html.match(/before/g) || []).length, 1, 'surrounding text is not spliced into the block')
    assert.equal((html.match(/after/g) || []).length, 1)
    assert.match(html, /<span class="chat-code-lang">js<\/span>/)
    assert.match(html, /chat-code-copy-btn/)
})

test('renderMarkdown: inline code is escaped and $& is literal there too', () => {
    const html = renderMarkdown('use `a<b && $&` here')
    assert.match(html, /<code class="chat-inline-code">a&lt;b &amp;&amp; \$&amp;<\/code>/)
    assert.doesNotMatch(html, /INLINE_|\x00/)
})

test('renderMarkdown: markdown inside a code block is not rendered', () => {
    const html = renderMarkdown('```\n**not bold** [x](https://e.com)\n```')
    assert.doesNotMatch(html, /<strong>|<a /)
})

test('renderMarkdown output is wrapped in <p> and split on blank lines', () => {
    const html = renderMarkdown('first\n\nsecond\nthird')
    assert.ok(html.startsWith('<p>'), html)
    assert.ok(html.endsWith('</p>'), html)
    assert.equal(html, '<p>first</p><p>second<br>third</p>')
    assert.equal(renderMarkdown(''), '<p></p>')
})

test('renderMarkdown: emphasis, headings, rules, quotes and lists', () => {
    assert.match(renderMarkdown('**bold** and *em*'), /<strong>bold<\/strong> and <em>em<\/em>/)
    assert.match(renderMarkdown('# Title'), /<h2 class="chat-md-heading">Title<\/h2>/)
    assert.match(renderMarkdown('## Sub'), /<h3 class="chat-md-heading">Sub<\/h3>/)
    assert.match(renderMarkdown('### Small'), /<h4 class="chat-md-heading">Small<\/h4>/)
    assert.match(renderMarkdown('a\n---\nb'), /<hr class="chat-md-hr">/)
    assert.match(renderMarkdown('> quoted'), /<blockquote class="chat-blockquote">quoted<\/blockquote>/)
    assert.match(renderMarkdown('- a\n- b'), /<ul class="chat-md-list"><li>a<\/li><li>b<\/li><\/ul>/)
    assert.match(renderMarkdown('1. a\n2. b'), /<ol class="chat-md-list"><li>a<\/li><li>b<\/li><\/ol>/)
})

test('renderMarkdown drops image placeholders left by the attachment pipeline', () => {
    assert.equal(renderMarkdown('see IMG_PLACEHOLDER_0 and IMG_PLACEHOLDER_12'), '<p>see  and </p>')
})
