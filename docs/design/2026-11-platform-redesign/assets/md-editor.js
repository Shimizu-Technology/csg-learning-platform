/*
 * Mockup of the shared MarkdownEditor (U-6.8, README §9): one editor, two modes.
 * Rich is a contenteditable surface with a toolbar, keyboard shortcuts and
 * Slack-style typing rules; Markdown is a monospace textarea with Preview.
 * Both read and write one Markdown string, so switching is lossless.
 * Markup: <div class="mde" data-mde data-label="…" [data-composer]> with an
 * optional .mde-bar holding [data-mde-fmt] and [data-mde-modes] slots, and the
 * starting Markdown in a <script type="text/markdown">. Not production code.
 */
(function () {
  const MODE_KEY = 'csg-mock-editor-mode'
  const store = {
    get() { try { return localStorage.getItem(MODE_KEY) } catch { return null } },
    set(v) { try { localStorage.setItem(MODE_KEY, v) } catch { /* private mode */ } },
  }
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  const MOD = isMac ? '⌘' : 'Ctrl+'
  const ARIA_MOD = isMac ? 'Meta' : 'Control'
  const ZW = /​/g
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  let uid = 0

  /* ---------- Markdown -> blocks (the supported subset) ---------- */
  const UNSUPPORTED = [
    [/^\s*\|.*\|\s*$/, 'a table'],
    [/!\[[^\]]*\]\([^)]*\)/, 'an image'],
    [/^\s*<\/?[a-z][^>]*>/i, 'HTML'],
    [/^\s*(?:---|\*\*\*)\s*$/, 'a divider'],
    [/^\s*[-*] \[[ xX]\] /, 'a checklist'],
    [/^\s{2,}(?:[-*]|\d+\.) /, 'a nested list'],
  ]
  const unsupported = (line) => UNSUPPORTED.filter(([re]) => re.test(line)).map(([, name]) => name)
  const BLOCK_START = /^```|^#{1,3} |^[-*] |^\d+\. |^> ?/

  function parse(md) {
    const lines = md.replace(/\r\n?/g, '\n').split('\n')
    const blocks = []
    const issues = new Set()
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      const fence = line.match(/^```\s*([\w+-]*)\s*$/)
      if (fence) {
        const body = []
        i++
        while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++])
        i++
        blocks.push({ t: 'code', lang: fence[1], text: body.join('\n') })
        continue
      }
      if (!line.trim()) { i++; continue }
      if (unsupported(line).length) {
        const raw = []
        while (i < lines.length && lines[i].trim() && unsupported(lines[i]).length) {
          unsupported(lines[i]).forEach((n) => issues.add(n))
          raw.push(lines[i++])
        }
        blocks.push({ t: 'raw', text: raw.join('\n') })
        continue
      }
      const h = line.match(/^(#{1,3}) (.*)$/)
      if (h) { blocks.push({ t: 'h', level: h[1].length, text: h[2] }); i++; continue }
      const listOf = (re) => {
        const items = []
        while (i < lines.length && re.test(lines[i]) && !unsupported(lines[i]).length) items.push(lines[i++].replace(re, ''))
        return items
      }
      if (/^[-*] /.test(line)) { blocks.push({ t: 'ul', items: listOf(/^[-*] /) }); continue }
      if (/^\d+\. /.test(line)) { blocks.push({ t: 'ol', items: listOf(/^\d+\. /) }); continue }
      if (/^> ?/.test(line)) { blocks.push({ t: 'quote', lines: listOf(/^> ?/) }); continue }
      const p = [lines[i++]]
      while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i]) && !unsupported(lines[i]).length) p.push(lines[i++])
      blocks.push({ t: 'p', lines: p })
    }
    return { blocks, issues: [...issues] }
  }

  function inline(src) {
    const codes = []
    let h = esc(src).replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000` })
    h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    h = h.replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
    h = h.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
    return h.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code class="ic">${codes[n]}</code>`)
  }

  function blocksToHtml(blocks, display) {
    return blocks.map((b) => {
      if (b.t === 'code') {
        return display
          ? `<div class="code"><div class="code-head">${esc(b.lang || 'code')}<button class="copy" type="button" data-toast="Copied"><i data-lucide="copy"></i>Copy</button></div><pre><code>${esc(b.text)}</code></pre></div>`
          : `<pre class="mde-pre" data-lang="${esc(b.lang)}"><code>${esc(b.text) || '​'}</code></pre>`
      }
      if (b.t === 'raw') {
        return display
          ? `<pre class="mde-raw-display">${esc(b.text)}</pre>`
          : `<div class="mde-raw" contenteditable="false" data-raw="${esc(b.text)}" title="Kept as Markdown text and saved unchanged">${esc(b.text)}</div>`
      }
      if (b.t === 'h') return `<h${b.level + 1}>${inline(b.text)}</h${b.level + 1}>`
      if (b.t === 'ul') return `<ul>${b.items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`
      if (b.t === 'ol') return `<ol>${b.items.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`
      if (b.t === 'quote') return `<blockquote><p>${b.lines.map(inline).join('<br>')}</p></blockquote>`
      return `<p>${b.lines.map(inline).join('<br>')}</p>`
    }).join('')
  }
  const toDisplay = (md) => blocksToHtml(parse(md).blocks, true)

  /* ---------- Rich DOM -> Markdown ---------- */
  const INLINE_TAGS = /^(STRONG|B|EM|I|CODE|A|SPAN|BR|FONT)$/
  function wrapMarks(inner, mark) {
    const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/)
    return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner
  }
  function inlineMd(node) {
    let s = ''
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) { s += n.nodeValue.replace(ZW, '').replace(/ /g, ' '); return }
      if (n.nodeType !== 1) return
      const tag = n.tagName
      if (tag === 'BR') { s += '\n'; return }
      if (tag === 'CODE') { const c = n.textContent.replace(ZW, ''); s += c ? `\`${c}\`` : ''; return }
      const inner = inlineMd(n)
      if (tag === 'STRONG' || tag === 'B') s += wrapMarks(inner, '**')
      else if (tag === 'EM' || tag === 'I') s += wrapMarks(inner, '_')
      else if (tag === 'A') s += `[${inner}](${n.getAttribute('href') || ''})`
      else s += inner
    })
    return s
  }
  function preText(node) {
    let s = ''
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) s += n.nodeValue
      else if (n.tagName === 'BR') s += '\n'
      else if (n.nodeType === 1) s += (/^(DIV|P)$/.test(n.tagName) && s && !s.endsWith('\n') ? '\n' : '') + preText(n)
    })
    return s.replace(ZW, '')
  }
  function toMarkdown(root) {
    const parts = []
    let loose = null
    const flush = () => { if (loose !== null) { parts.push(loose); loose = null } }
    const trimEnd = (t) => t.replace(/\n+$/, '')
    root.childNodes.forEach((n) => {
      if (n.nodeType === 3 || (n.nodeType === 1 && INLINE_TAGS.test(n.tagName))) {
        const tmp = document.createElement('span')
        tmp.appendChild(n.cloneNode(true))
        loose = (loose || '') + inlineMd(tmp)
        return
      }
      flush()
      if (n.nodeType !== 1) return
      const tag = n.tagName
      if (n.classList.contains('mde-raw')) parts.push(n.dataset.raw)
      else if (tag === 'PRE') parts.push(`\`\`\`${n.dataset.lang || ''}\n${trimEnd(preText(n))}\n\`\`\``)
      else if (/^H[2-4]$/.test(tag)) parts.push(`${'#'.repeat(Number(tag[1]) - 1)} ${inlineMd(n).trim()}`)
      else if (tag === 'UL' || tag === 'OL') {
        parts.push([...n.children].filter((li) => li.tagName === 'LI')
          .map((li, k) => `${tag === 'UL' ? '- ' : `${k + 1}. `}${trimEnd(inlineMd(li)).replace(/\n/g, ' ')}`).join('\n'))
      } else if (tag === 'BLOCKQUOTE') {
        const text = [...n.childNodes].map((c) => (c.nodeType === 1 && /^(P|DIV)$/.test(c.tagName) ? trimEnd(inlineMd(c)) : inlineMd({ childNodes: [c] }))).join('\n')
        parts.push(trimEnd(text).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'))
      } else parts.push(trimEnd(inlineMd(n)))
    })
    flush()
    return parts.map(trimEnd).filter((p) => p.trim() !== '').join('\n\n')
  }

  /* ---------- Helpers ---------- */
  const looksLikeMarkdown = (t) => /(\*\*[^*\n]+\*\*|`[^`\n]+`|^```|^\s*[-*] |^\s*\d+\. |^> |^#{1,3} |\[[^\]]+\]\([^)\s]+\))/m.test(t)
  const closestEl = (node, sel) => (node && (node.nodeType === 1 ? node : node.parentElement))?.closest(sel) || null
  const placeCaret = (node, atEnd = true) => {
    const r = document.createRange()
    r.selectNodeContents(node)
    r.collapse(!atEnd)
    const sel = getSelection()
    sel.removeAllRanges()
    sel.addRange(r)
  }

  const TOOLS = [
    { k: 'bold', icon: 'bold', label: 'Bold', key: 'B', aria: 'B' },
    { k: 'italic', icon: 'italic', label: 'Italic', key: 'I', aria: 'I' },
    { k: 'code', icon: 'code', label: 'Inline code', key: 'E', aria: 'E' },
    { k: 'codeblock', icon: 'square-code', label: 'Code block', key: '⇧C', aria: 'Shift+C' },
    { k: 'ul', icon: 'list', label: 'Bulleted list', key: '⇧8', aria: 'Shift+8' },
    { k: 'ol', icon: 'list-ordered', label: 'Numbered list', key: '⇧7', aria: 'Shift+7' },
    { k: 'quote', icon: 'text-quote', label: 'Quote', key: '⇧9', aria: 'Shift+9' },
    { k: 'link', icon: 'link', label: 'Link', key: '⇧U', aria: 'Shift+U' },
  ]
  const SHORTCUTS = { b: 'bold', i: 'italic', e: 'code', 'S-KeyC': 'codeblock', 'S-Digit8': 'ul', 'S-Digit7': 'ol', 'S-Digit9': 'quote', 'S-KeyU': 'link' }
  window.mdeShortcutLabel = (k) => { const t = TOOLS.find((x) => x.k === k); return t ? `${MOD}${t.key}` : '' }

  /* ---------- One editor ---------- */
  function build(el) {
    const id = `mde${++uid}`
    const label = el.dataset.label || 'Text'
    const composer = 'composer' in el.dataset
    const srcTpl = el.querySelector('script[type="text/markdown"]')
    const initial = srcTpl ? srcTpl.textContent.replace(/^\n/, '').replace(/\s+$/, '') : ''
    if (srcTpl) srcTpl.remove()

    let bar = el.querySelector('.mde-bar')
    if (!bar) {
      bar = document.createElement('div')
      bar.className = 'mde-bar'
      bar.innerHTML = '<span data-mde-fmt></span><span class="spacer"></span><span data-mde-preview></span><span data-mde-modes></span>'
      el.prepend(bar)
    }
    const fmtSlot = bar.querySelector('[data-mde-fmt]')
    fmtSlot.className = 'mde-fmt'
    fmtSlot.setAttribute('role', 'toolbar')
    fmtSlot.setAttribute('aria-label', `Formatting for ${label.toLowerCase()}`)
    fmtSlot.innerHTML = `<span class="mde-fmt-h">Format</span><span class="mde-tools">${TOOLS.map((t) => `<button type="button" class="mde-tool" data-cmd="${t.k}" aria-label="${t.label}" title="${t.label} (${MOD}${t.key})" aria-keyshortcuts="${ARIA_MOD}+${t.aria}" ${t.k === 'link' ? `data-popover="${id}-link" aria-expanded="false"` : 'aria-pressed="false"'}><i data-lucide="${t.icon}"></i></button>`).join('')}</span><span class="mde-fmt-h mde-mode-h">Editor</span>`
    const aa = document.createElement('button')
    aa.type = 'button'
    aa.className = 'mde-aa'
    aa.textContent = 'Aa'
    aa.setAttribute('aria-label', 'Formatting and editor mode')
    aa.setAttribute('aria-expanded', 'false')
    fmtSlot.before(aa)
    const modes = bar.querySelector('[data-mde-modes]')
    modes.className = 'seg mde-modes'
    modes.setAttribute('role', 'group')
    modes.setAttribute('aria-label', 'Editor mode')
    modes.innerHTML = `<button type="button" data-mode="rich" title="Rich: formatting as you type">Rich</button><button type="button" data-mode="markdown" title="Markdown: plain text with Preview (${MOD}⇧M switches)">Markdown</button>`
    fmtSlot.appendChild(modes)
    const prevSlot = bar.querySelector('[data-mde-preview]') || (() => { const s = document.createElement('span'); modes.before(s); return s })()
    prevSlot.outerHTML = `<button type="button" class="btn btn-ghost btn-sm mde-preview-btn" aria-pressed="false" title="Preview" hidden><i data-lucide="eye"></i><span>Preview</span></button>`
    const previewBtn = bar.querySelector('.mde-preview-btn')

    const surface = document.createElement('div')
    surface.className = 'mde-surface'
    surface.innerHTML = `
      <div class="mde-rich prose" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${label}, rich text" data-placeholder="${el.dataset.placeholder || ''}"></div>
      <textarea class="mde-src" aria-label="${label}, Markdown" spellcheck="true" placeholder="${el.dataset.placeholder || ''}" hidden></textarea>
      <div class="mde-preview prose" role="region" aria-label="Preview of ${label.toLowerCase()}" tabindex="0" hidden></div>`
    const warn = document.createElement('div')
    warn.className = 'mde-warn'
    warn.setAttribute('role', 'status')
    warn.hidden = true
    const note = document.createElement('div')
    note.className = 'mde-note'
    note.hidden = true
    const live = document.createElement('span')
    live.className = 'sr-only'
    live.setAttribute('aria-live', 'polite')
    const linkPop = document.createElement('div')
    linkPop.className = 'popover mde-link-pop'
    linkPop.id = `${id}-link`
    linkPop.hidden = true
    linkPop.innerHTML = `<label class="label" for="${id}-url">Link address</label><div class="hstack"><input class="input" id="${id}-url" type="url" placeholder="https://" value="https://"><button type="button" class="btn btn-primary btn-sm">Add link</button></div>`
    if (composer) { el.prepend(warn); el.prepend(note); el.prepend(surface) } else { bar.after(surface); surface.after(note); note.after(warn) }
    el.append(live, linkPop)

    const rich = surface.querySelector('.mde-rich')
    const src = surface.querySelector('.mde-src')
    const preview = surface.querySelector('.mde-preview')
    const api = { mode: null, enterSends: true, onSubmit: null, readOnly: false }
    el._mde = api

    const announce = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t }, 30) }
    const flash = (t) => { note.textContent = t; note.hidden = false; clearTimeout(note._t); note._t = setTimeout(() => { note.hidden = true }, 4500) }
    const emptyCheck = () => rich.classList.toggle('is-empty', !rich.textContent.replace(ZW, '').trim() && !rich.querySelector('pre, .mde-raw, li'))
    const changed = () => { emptyCheck(); refreshWarn(); el.dispatchEvent(new CustomEvent('mde:change', { bubbles: true })) }
    function refreshWarn(issues) {
      const raws = api.mode === 'rich' ? rich.querySelectorAll('.mde-raw').length : 0
      if (!raws) { warn.hidden = true; return }
      if (issues && issues.length) warn.dataset.issues = issues.join(', ')
      warn.hidden = false
      warn.innerHTML = `<i data-lucide="triangle-alert"></i><span class="grow">Rich mode can't edit ${warn.dataset.issues || 'part of this text'}. It's shown as Markdown text and saved unchanged.</span><button type="button" class="btn btn-ghost btn-sm" data-mde-to-md>Edit in Markdown</button>`
      window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } })
    }
    const setRich = (md) => {
      const { blocks, issues } = parse(md)
      rich.innerHTML = blocksToHtml(blocks, false) || '<p><br></p>'
      emptyCheck()
      return issues
    }
    api.getMarkdown = () => (api.mode === 'rich' ? toMarkdown(rich) : src.value.replace(/\s+$/, ''))
    api.setMarkdown = (md) => {
      if (api.mode === 'rich') refreshWarn(setRich(md))
      else { src.value = md; if (!preview.hidden) preview.innerHTML = toDisplay(md) }
      changed()
    }
    api.clear = () => api.setMarkdown('')
    api.focus = () => { const t = api.mode === 'rich' ? rich : src; t.focus(); if (api.mode === 'rich') placeCaret(rich) }
    api.appendText = (t) => {
      const md = api.getMarkdown()
      api.setMarkdown(md ? `${md.replace(/\s+$/, '')} ${t.trim()}` : t.trim())
      api.focus()
      if (api.mode === 'markdown') src.setSelectionRange(src.value.length, src.value.length)
    }
    api.setReadOnly = (ro) => {
      api.readOnly = ro
      rich.contentEditable = String(!ro)
      src.readOnly = ro
      el.classList.toggle('is-readonly', ro)
      bar.querySelectorAll('.mde-tool').forEach((b) => { b.disabled = ro })
    }

    function setMode(mode, opts = {}) {
      if (mode === api.mode) return
      const md = api.mode ? api.getMarkdown() : initial
      api.mode = mode
      if (mode === 'rich') refreshWarn(setRich(md))
      else { src.value = md; warn.hidden = true }
      rich.hidden = mode !== 'rich'
      src.hidden = mode !== 'markdown'
      preview.hidden = true
      previewBtn.hidden = mode !== 'markdown'
      previewBtn.setAttribute('aria-pressed', 'false')
      el.dataset.mode = mode
      modes.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)))
      bar.querySelectorAll('.mde-tool').forEach((b) => { b.disabled = api.readOnly })
      if (opts.remember) store.set(mode)
      if (opts.announce) announce(mode === 'rich' ? 'Rich mode. Same text, shown with formatting.' : 'Markdown mode. Same text, shown as Markdown.')
      if (opts.focus && !api.readOnly) {
        if (mode === 'rich') { rich.focus(); placeCaret(rich) } else { src.focus(); src.setSelectionRange(src.value.length, src.value.length) }
      }
      updateHint()
    }
    api.setMode = (m) => setMode(m, { remember: true })
    function togglePreview() {
      const on = preview.hidden
      if (on) preview.innerHTML = toDisplay(src.value) || '<p class="muted">Nothing to preview yet.</p>'
      preview.hidden = !on
      src.hidden = on
      previewBtn.setAttribute('aria-pressed', String(on))
      bar.querySelectorAll('.mde-tool').forEach((b) => { b.disabled = on || api.readOnly })
      window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } })
      announce(on ? 'Preview shown. Press Preview again to edit.' : 'Editing Markdown.')
      ;(on ? preview : src).focus()
    }

    /* ----- Rich commands ----- */
    const blockOf = (node) => {
      let n = node
      if (!n || n === rich || !rich.contains(n)) return null
      while (n.parentNode && n.parentNode !== rich) n = n.parentNode
      return n.parentNode === rich ? n : null
    }
    function toggleInlineCode() {
      const sel = getSelection()
      if (!sel.rangeCount) return
      const r = sel.getRangeAt(0)
      const inCode = closestEl(r.startContainer, 'code.ic')
      if (inCode && rich.contains(inCode)) { inCode.replaceWith(document.createTextNode(inCode.textContent.replace(ZW, ''))); return }
      const code = document.createElement('code')
      code.className = 'ic'
      code.textContent = r.collapsed ? 'code' : r.toString()
      r.deleteContents()
      r.insertNode(code)
      code.after(document.createTextNode('​'))
      const nr = document.createRange()
      nr.selectNodeContents(code)
      sel.removeAllRanges()
      sel.addRange(nr)
    }
    function insertCodeBlock() {
      const sel = getSelection()
      const r = sel.rangeCount ? sel.getRangeAt(0) : null
      const text = r && !r.collapsed ? r.toString() : ''
      if (r && !r.collapsed) r.deleteContents()
      const pre = document.createElement('pre')
      pre.className = 'mde-pre'
      pre.dataset.lang = ''
      const code = document.createElement('code')
      code.textContent = text || '​'
      pre.appendChild(code)
      const block = r ? blockOf(r.startContainer) : null
      if (block) { if (!block.textContent.replace(ZW, '').trim()) block.replaceWith(pre); else block.after(pre) } else rich.appendChild(pre)
      if (!pre.nextSibling) { const p = document.createElement('p'); p.innerHTML = '<br>'; pre.after(p) }
      placeCaret(code)
    }
    function richCmd(cmd) {
      rich.focus()
      if (cmd === 'bold') document.execCommand('bold')
      else if (cmd === 'italic') document.execCommand('italic')
      else if (cmd === 'code') toggleInlineCode()
      else if (cmd === 'codeblock') insertCodeBlock()
      else if (cmd === 'ul') document.execCommand('insertUnorderedList')
      else if (cmd === 'ol') document.execCommand('insertOrderedList')
      else if (cmd === 'quote') document.execCommand('formatBlock', false, closestEl(getSelection().anchorNode, 'blockquote') ? 'p' : 'blockquote')
      changed()
      syncPressed()
    }
    /* ----- Markdown commands (insert syntax around the selection) ----- */
    function mdWrap(before, after, placeholder) {
      const { selectionStart: s, selectionEnd: e, value: v } = src
      const sel = v.slice(s, e) || placeholder
      src.setRangeText(before + sel + after, s, e, 'end')
      src.setSelectionRange(s + before.length, s + before.length + sel.length)
    }
    function mdLines(fn) {
      const v = src.value
      const s = v.lastIndexOf('\n', src.selectionStart - 1) + 1
      let e = v.indexOf('\n', src.selectionEnd)
      if (e === -1) e = v.length
      const out = v.slice(s, e).split('\n').map(fn).join('\n')
      src.setRangeText(out, s, e, 'end')
    }
    function mdCmd(cmd) {
      src.focus()
      if (cmd === 'bold') mdWrap('**', '**', 'bold text')
      else if (cmd === 'italic') mdWrap('_', '_', 'italic text')
      else if (cmd === 'code') mdWrap('`', '`', 'code')
      else if (cmd === 'codeblock') {
        const atLineStart = src.selectionStart === 0 || src.value[src.selectionStart - 1] === '\n'
        mdWrap(`${atLineStart ? '' : '\n'}\`\`\`\n`, '\n```\n', '')
      } else if (cmd === 'ul') mdLines((l) => `- ${l}`)
      else if (cmd === 'ol') mdLines((l, k) => `${k + 1}. ${l}`)
      else if (cmd === 'quote') mdLines((l) => `> ${l}`)
      changed()
    }
    const run = (cmd) => { if (api.readOnly) return; if (api.mode === 'rich') richCmd(cmd); else if (preview.hidden) mdCmd(cmd) }

    /* ----- Link popover ----- */
    let savedRange = null
    const linkBtn = bar.querySelector('[data-cmd="link"]')
    linkBtn.addEventListener('mousedown', () => { const s = getSelection(); savedRange = s.rangeCount && rich.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null })
    linkBtn.addEventListener('click', () => setTimeout(() => { if (!linkPop.hidden) linkPop.querySelector('input').select() }, 0))
    const addLink = () => {
      const url = linkPop.querySelector('input').value.trim()
      linkPop.hidden = true
      linkBtn.setAttribute('aria-expanded', 'false')
      if (!url || url === 'https://') return
      if (api.mode === 'rich') {
        rich.focus()
        if (savedRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange) }
        if (getSelection().isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(url)}</a>`)
        else document.execCommand('createLink', false, url)
      } else { src.focus(); mdWrap('[', `](${url})`, 'link text') }
      changed()
    }
    linkPop.querySelector('button').addEventListener('click', addLink)
    linkPop.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLink() } })

    /* ----- Toolbar, modes, preview, phone menu ----- */
    bar.addEventListener('mousedown', (e) => { if (e.target.closest('.mde-tool:not([data-cmd="link"])')) e.preventDefault() })
    bar.addEventListener('click', (e) => {
      const tool = e.target.closest('.mde-tool')
      if (tool && tool.dataset.cmd !== 'link') run(tool.dataset.cmd)
      const m = e.target.closest('[data-mode]')
      if (m) setMode(m.dataset.mode, { remember: true, announce: true, focus: true })
    })
    previewBtn.addEventListener('click', togglePreview)
    aa.addEventListener('click', () => {
      const open = !el.classList.contains('menu-open')
      el.classList.toggle('menu-open', open)
      el.classList.remove('menu-up')
      if (open) {
        const frame = el.closest('.frame') || document.documentElement
        if (fmtSlot.getBoundingClientRect().bottom > frame.getBoundingClientRect().bottom - 8) el.classList.add('menu-up')
      }
      aa.setAttribute('aria-expanded', String(open))
      if (open) bar.querySelector('.mde-tool')?.focus()
    })
    warn.addEventListener('click', (e) => { if (e.target.closest('[data-mde-to-md]')) setMode('markdown', { remember: true, announce: true, focus: true }) })

    /* ----- Typing rules (Rich): **bold**, `code`, _italic_, - , 1. , > , ## , ``` + Enter ----- */
    function inlineRules() {
      const sel = getSelection()
      if (!sel.rangeCount || !sel.isCollapsed) return
      const node = sel.anchorNode
      if (!node || node.nodeType !== 3 || !rich.contains(node) || closestEl(node, 'pre, code')) return
      const off = sel.anchorOffset
      const before = node.nodeValue.slice(0, off)
      const rules = [[/\*\*([^*]+)\*\*$/, 'strong'], [/`([^`]+)`$/, 'code'], [/(?:^|\s)_([^_]+)_$/, 'em']]
      for (const [re, tag] of rules) {
        const m = before.match(re)
        if (!m) continue
        const full = m[0].replace(/^\s/, '')
        const range = document.createRange()
        range.setStart(node, off - full.length)
        range.setEnd(node, off)
        range.deleteContents()
        const mark = document.createElement(tag)
        if (tag === 'code') mark.className = 'ic'
        mark.textContent = m[1]
        range.insertNode(mark)
        const after = document.createTextNode('​')
        mark.after(after)
        sel.collapse(after, 1)
        return
      }
    }
    function textBeforeCaretInBlock() {
      const sel = getSelection()
      if (!sel.rangeCount) return null
      const block = blockOf(sel.anchorNode)
      if (!block) return null
      const r = document.createRange()
      r.setStart(block, 0)
      r.setEnd(sel.anchorNode, sel.anchorOffset)
      return { block, range: r, text: r.toString().replace(ZW, '') }
    }
    function blockRuleOnSpace() {
      const info = textBeforeCaretInBlock()
      if (!info || /^(UL|OL|PRE|BLOCKQUOTE|H\d)$/.test(info.block.nodeName) || closestEl(getSelection().anchorNode, 'li, pre')) return false
      const map = { '-': ['insertUnorderedList'], '*': ['insertUnorderedList'], '1.': ['insertOrderedList'], '>': ['formatBlock', 'blockquote'], '#': ['formatBlock', 'h2'], '##': ['formatBlock', 'h3'], '###': ['formatBlock', 'h4'] }
      const hit = map[info.text]
      if (!hit) return false
      info.range.deleteContents()
      let block = info.block
      if (block.nodeType === 3) { const p = document.createElement('p'); block.replaceWith(p); p.appendChild(block); block = p }
      if (!block.textContent.replace(ZW, '')) block.innerHTML = '<br>'
      placeCaret(block, false)
      document.execCommand(hit[0], false, hit[1])
      return true
    }
    function fenceRuleOnEnter() {
      const info = textBeforeCaretInBlock()
      if (!info) return false
      const m = info.block.textContent.replace(ZW, '').match(/^```([\w+-]*)$/)
      if (!m || info.block.nodeName === 'PRE') return false
      const pre = document.createElement('pre')
      pre.className = 'mde-pre'
      pre.dataset.lang = m[1]
      const code = document.createElement('code')
      code.textContent = '​'
      pre.appendChild(code)
      info.block.replaceWith(pre)
      if (!pre.nextSibling) { const p = document.createElement('p'); p.innerHTML = '<br>'; pre.after(p) }
      placeCaret(code)
      return true
    }
    function enterInPre(pre) {
      const code = pre.querySelector('code') || pre
      const sel = getSelection()
      const r = document.createRange()
      r.selectNodeContents(code)
      r.setStart(sel.anchorNode, sel.anchorOffset)
      const after = r.toString().replace(ZW, '')
      const all = preText(code)
      if (!after && /\n$/.test(all)) {
        code.textContent = all.replace(/\n+$/, '') || '​'
        let next = pre.nextElementSibling
        if (!next || next.nodeName !== 'P') { next = document.createElement('p'); next.innerHTML = '<br>'; pre.after(next) }
        placeCaret(next, false)
        return
      }
      document.execCommand('insertText', false, after ? '\n' : '\n​')
    }
    const fenceOpenInSource = () => (src.value.slice(0, src.selectionStart).match(/^```/gm) || []).length % 2 === 1
    const inBlock = () => (api.mode === 'rich' ? Boolean(closestEl(getSelection().anchorNode, 'pre, li')) : fenceOpenInSource())
    api.inBlock = inBlock

    function onKeydown(e) {
      const mod = e.metaKey || e.ctrlKey
      if (mod) {
        const key = e.shiftKey ? `S-${e.code}` : e.key.toLowerCase()
        if (key === 'S-KeyM') { e.preventDefault(); setMode(api.mode === 'rich' ? 'markdown' : 'rich', { remember: true, announce: true, focus: true }); return }
        if (key === 'S-KeyV') { plainNext = true; setTimeout(() => { plainNext = false }, 500); return }
        const cmd = SHORTCUTS[key]
        if (cmd) {
          e.preventDefault()
          if (cmd === 'link') linkBtn.click()
          else run(cmd)
          return
        }
      }
      if (e.key === 'Enter' && !e.isComposing) {
        if (composer && api.onSubmit) {
          if (mod) { e.preventDefault(); api.onSubmit(); return }
          if (api.enterSends && !e.shiftKey && !inBlock()) { e.preventDefault(); api.onSubmit(); return }
        }
        if (api.mode === 'rich' && !e.shiftKey) {
          const pre = closestEl(getSelection().anchorNode, 'pre')
          if (pre && rich.contains(pre)) { e.preventDefault(); enterInPre(pre); changed(); return }
          if (fenceRuleOnEnter()) { e.preventDefault(); changed() }
        }
      }
      if (e.key === ' ' && api.mode === 'rich' && blockRuleOnSpace()) { e.preventDefault(); changed() }
    }
    rich.addEventListener('keydown', onKeydown)
    src.addEventListener('keydown', onKeydown)
    rich.addEventListener('input', (e) => { if (e.inputType === 'insertText') inlineRules(); changed() })
    src.addEventListener('input', changed)

    /* ----- Paste: Markdown converts in Rich; ⌘⇧V pastes plain ----- */
    let plainNext = false
    rich.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return
      e.preventDefault()
      if (plainNext || closestEl(getSelection().anchorNode, 'pre') || !looksLikeMarkdown(text)) {
        document.execCommand('insertText', false, text)
      } else {
        const { blocks, issues } = parse(text)
        document.execCommand('insertHTML', false, blocksToHtml(blocks, false))
        flash(`Pasted Markdown as formatting. ${MOD}Z undoes it; ${MOD}⇧V pastes plain text.`)
        if (issues.length) refreshWarn(issues)
      }
      plainNext = false
      changed()
    })

    /* ----- Active-state on toolbar buttons and the composer hint ----- */
    function syncPressed() {
      if (api.mode !== 'rich') { bar.querySelectorAll('.mde-tool[aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', 'false')); return }
      const n = getSelection().anchorNode
      if (!n || !rich.contains(n)) return
      const st = { bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), code: Boolean(closestEl(n, 'code.ic')), codeblock: Boolean(closestEl(n, 'pre')), ul: Boolean(closestEl(n, 'ul')), ol: Boolean(closestEl(n, 'ol')), quote: Boolean(closestEl(n, 'blockquote')) }
      bar.querySelectorAll('.mde-tool[aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', String(Boolean(st[b.dataset.cmd]))))
    }
    function updateHint() { el.dispatchEvent(new CustomEvent('mde:caret', { bubbles: true, detail: { inBlock: api.mode ? inBlock() : false } })) }
    document.addEventListener('selectionchange', () => {
      const n = getSelection().anchorNode
      if (rich.contains(n) || document.activeElement === src) { syncPressed(); updateHint() }
    })

    document.execCommand('defaultParagraphSeparator', false, 'p')
    setMode(store.get() === 'markdown' ? 'markdown' : 'rich')
  }

  window.MarkdownEditor = { parse, toDisplay, toMarkdown, init: (root = document) => root.querySelectorAll('[data-mde]').forEach((el) => { if (!el._mde) build(el) }) }
  document.addEventListener('DOMContentLoaded', () => window.MarkdownEditor.init())
})()
