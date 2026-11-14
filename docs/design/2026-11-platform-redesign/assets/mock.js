/*
 * Mockup behavior. Data-attribute driven so each page stays plain markup.
 * Not production code: it only makes the static mockups clickable.
 */
(function () {
  const store = {
    get(key) { try { return localStorage.getItem(key) } catch { return null } },
    set(key, value) { try { localStorage.setItem(key, value) } catch { /* private mode */ } },
  }
  const $ = (sel, root = document) => root.querySelector(sel)
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel))
  const icons = () => { if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } }) }
  const frame = () => $('.frame')
  const isPhone = () => (frame()?.clientWidth || window.innerWidth) <= 760

  /* ---------- Review bar ---------- */
  function buildReviewBar() {
    const body = document.body
    const title = body.dataset.mockTitle
    if (!title) return
    const variants = body.dataset.variants ? JSON.parse(body.dataset.variants) : null
    const bar = document.createElement('header')
    bar.className = 'review-bar'
    bar.innerHTML = `
      <div class="rb-title"><a class="rb-back" href="index.html"><i data-lucide="chevron-left"></i>Review hub</a><span>${title}</span></div>
      ${variants ? `<div class="seg" role="group" aria-label="Variant" data-rb="variant">${variants.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div>` : ''}
      <div class="seg" role="group" aria-label="Theme" data-rb="theme">
        <button type="button" data-v="light" title="Light"><i data-lucide="sun"></i><span class="lbl">Light</span></button>
        <button type="button" data-v="dark" title="Dark"><i data-lucide="moon"></i><span class="lbl">Dark</span></button>
        <button type="button" data-v="system" title="System"><i data-lucide="monitor"></i><span class="lbl">System</span></button>
      </div>
      <div class="seg" role="group" aria-label="Width" data-rb="device">
        <button type="button" data-v="desktop" title="Desktop 1280"><i data-lucide="laptop"></i><span class="lbl">Desktop</span></button>
        <button type="button" data-v="phone" title="Phone 390"><i data-lucide="smartphone"></i><span class="lbl">Phone</span></button>
      </div>
      ${$('#mock-notes') ? '<button type="button" class="rb-notes-btn" data-rb-notes aria-expanded="false"><i data-lucide="list-checks"></i>Notes</button>' : ''}`
    body.prepend(bar)

    const notesTpl = $('#mock-notes')
    if (notesTpl) {
      const panel = document.createElement('aside')
      panel.className = 'rb-notes'
      panel.hidden = true
      panel.appendChild(notesTpl.content.cloneNode(true))
      body.appendChild(panel)
      const btn = $('[data-rb-notes]', bar)
      btn.addEventListener('click', () => {
        panel.hidden = !panel.hidden
        btn.setAttribute('aria-expanded', String(!panel.hidden))
      })
    }

    const theme = store.get('csg-mock-theme') || 'system'
    setTheme(theme)
    $$('[data-rb="theme"] button', bar).forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.v)))

    const device = store.get('csg-mock-device') || (window.innerWidth < 720 ? 'phone' : 'desktop')
    setDevice(device)
    $$('[data-rb="device"] button', bar).forEach((b) => b.addEventListener('click', () => setDevice(b.dataset.v)))

    if (variants) {
      const initial = new URLSearchParams(location.search).get('variant') || variants[0][0]
      setVariant(initial)
      $$('[data-rb="variant"] button', bar).forEach((b) => b.addEventListener('click', () => setVariant(b.dataset.v)))
    }
  }

  function pressIn(group, value) {
    $$(`[data-rb="${group}"] button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === value)))
  }
  function setTheme(value) {
    if (value === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.dataset.theme = value
    store.set('csg-mock-theme', value)
    pressIn('theme', value)
  }
  function setDevice(value) {
    const f = frame()
    if (f) f.dataset.device = value
    store.set('csg-mock-device', value)
    pressIn('device', value)
    requestAnimationFrame(() => $$('[role="tablist"]').forEach(placeIndicator))
  }
  function setVariant(value) {
    $$('[data-variant]').forEach((el) => { el.hidden = !el.dataset.variant.split(' ').includes(value) })
    pressIn('variant', value)
    const url = new URL(location.href)
    url.searchParams.set('variant', value)
    history.replaceState(null, '', url)
    $$('[role="tablist"]').forEach(placeIndicator)
    const main = $('.main')
    if (main) { main.scrollTop = 0; main.classList.remove('page-enter'); void main.offsetWidth; main.classList.add('page-enter') }
  }

  /* ---------- Tabs ---------- */
  function placeIndicator(list) {
    const ind = $('.tab-indicator', list)
    const sel = $('[aria-selected="true"]', list)
    if (!ind || !sel) return
    ind.style.width = `${sel.offsetWidth}px`
    ind.style.transform = `translateX(${sel.offsetLeft}px)`
  }
  function initTabs() {
    $$('[role="tablist"]').forEach((list) => {
      if (!$('.tab-indicator', list)) {
        const ind = document.createElement('span')
        ind.className = 'tab-indicator'
        list.appendChild(ind)
      }
      placeIndicator(list)
      $$('[role="tab"]', list).forEach((tab) => {
        tab.addEventListener('click', () => {
          $$('[role="tab"]', list).forEach((t) => {
            const on = t === tab
            t.setAttribute('aria-selected', String(on))
            const panel = document.getElementById(t.getAttribute('aria-controls'))
            if (panel) panel.hidden = !on
          })
          placeIndicator(list)
        })
      })
    })
    window.addEventListener('resize', () => $$('[role="tablist"]').forEach(placeIndicator))
  }

  /* ---------- Generic switch groups (segmented view controls) ---------- */
  function initSwitchGroups() {
    $$('[data-switch-group]').forEach((group) => {
      const name = group.dataset.switchGroup
      const buttons = $$('[data-switch]', group)
      const apply = (value) => {
        buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.switch === value)))
        $$(`[data-switch-panel^="${name}:"]`).forEach((p) => { p.hidden = p.dataset.switchPanel !== `${name}:${value}` })
      }
      buttons.forEach((b) => b.addEventListener('click', () => apply(b.dataset.switch)))
      const current = buttons.find((b) => b.getAttribute('aria-pressed') === 'true') || buttons[0]
      if (current) apply(current.dataset.switch)
    })
  }

  /* ---------- Accordions ---------- */
  function initAccordions() {
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('.acc-trigger')
      if (!trigger) return
      const acc = trigger.closest('.acc')
      const open = acc.dataset.open !== 'true'
      acc.dataset.open = String(open)
      trigger.setAttribute('aria-expanded', String(open))
    })
  }

  /* ---------- Search + chip filters ---------- */
  function applyFilter(list) {
    const q = (list._q || '').trim().toLowerCase()
    const chip = list._chip || 'all'
    const attr = list._chipAttr || 'status'
    let shown = 0
    $$('[data-item]', list).forEach((item) => {
      const text = (item.dataset.search || item.textContent).toLowerCase()
      const values = (item.dataset[attr] || '').split(' ')
      const ok = (!q || text.includes(q)) && (chip === 'all' || values.includes(chip))
      item.hidden = !ok
      if (ok) shown++
    })
    $$('[data-group]', list).forEach((g) => { g.hidden = $$('[data-item]', g).every((i) => i.hidden) })
    const empty = document.querySelector(`[data-empty-for="${list.id}"]`)
    if (empty) {
      empty.hidden = shown > 0
      const qEl = $('[data-empty-q]', empty)
      if (qEl) qEl.textContent = list._q || ''
    }
  }
  function initFilters() {
    $$('input[data-filter]').forEach((input) => {
      const list = $(input.dataset.filter)
      if (!list) return
      input.addEventListener('input', () => { list._q = input.value; applyFilter(list) })
    })
    $$('[data-chips]').forEach((group) => {
      const list = group.dataset.filterTarget ? $(group.dataset.filterTarget) : null
      $$('.chip', group).forEach((chip) => chip.addEventListener('click', () => {
        $$('.chip', group).forEach((c) => c.setAttribute('aria-pressed', String(c === chip)))
        if (list) { list._chip = chip.dataset.value; list._chipAttr = group.dataset.attr || 'status'; applyFilter(list) }
      }))
      const pressed = $('.chip[aria-pressed="true"]', group)
      if (list && pressed && pressed.dataset.value !== 'all') { list._chip = pressed.dataset.value; list._chipAttr = group.dataset.attr || 'status'; applyFilter(list) }
    })
    $$('[data-clear-filter]').forEach((btn) => btn.addEventListener('click', () => {
      const list = $(btn.dataset.clearFilter)
      const input = $(`input[data-filter="${btn.dataset.clearFilter}"]`)
      if (input) input.value = ''
      list._q = ''
      applyFilter(list)
    }))
  }

  /* ---------- Overlays (drawer, sheet, modal) ---------- */
  let lastFocus = null
  function openOverlay(id) {
    const el = document.getElementById(id)
    if (!el) return
    lastFocus = document.activeElement
    el.classList.add('open')
    const focusable = $('[autofocus], input, textarea, button', $('.drawer, .modal', el) || el)
    if (focusable) setTimeout(() => focusable.focus(), 30)
  }
  function closeOverlays() {
    $$('.overlay.open').forEach((o) => o.classList.remove('open'))
    $$('.palette.open').forEach((o) => o.classList.remove('open'))
    $$('.popover:not([hidden])').forEach((p) => { p.hidden = true })
    $$('[data-popover][aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'))
    if (lastFocus) { lastFocus.focus(); lastFocus = null }
  }
  function initOverlays() {
    document.addEventListener('click', (e) => {
      const opener = e.target.closest('[data-open]')
      if (opener) { e.preventDefault(); openOverlay(opener.dataset.open); return }
      if (e.target.closest('[data-close]') || e.target.classList.contains('scrim')) { closeOverlays(); return }
      const pop = e.target.closest('[data-popover]')
      if (pop) {
        e.preventDefault()
        const target = document.getElementById(pop.dataset.popover)
        const willOpen = target.hidden
        $$('.popover').forEach((p) => { p.hidden = true })
        target.hidden = !willOpen
        pop.setAttribute('aria-expanded', String(willOpen))
        return
      }
      if (!e.target.closest('.popover')) {
        $$('.popover:not([hidden])').forEach((p) => { p.hidden = true })
      }
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeOverlays()
    })
  }

  /* ---------- Toasts ---------- */
  function toast(message, action) {
    const host = $('.toasts') || (() => {
      const t = document.createElement('div')
      t.className = 'toasts'
      t.setAttribute('role', 'status')
      t.setAttribute('aria-live', 'polite')
      frame().appendChild(t)
      return t
    })()
    const el = document.createElement('div')
    el.className = 'toast'
    el.innerHTML = `<i data-lucide="check"></i><span>${message}</span>${action ? `<button type="button" class="t-action">${action}</button>` : ''}`
    host.appendChild(el)
    while (host.children.length > 3) host.firstElementChild.remove()
    icons()
    let timer
    const leave = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 180) }
    const arm = () => { timer = setTimeout(leave, action ? 6000 : 4000) }
    el.addEventListener('mouseenter', () => clearTimeout(timer))
    el.addEventListener('mouseleave', arm)
    $('.t-action', el)?.addEventListener('click', leave)
    arm()
  }
  window.mockToast = toast
  function initToasts() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-toast]')
      if (t) toast(t.dataset.toast, t.dataset.toastAction)
    })
  }

  /* ---------- Command palette ---------- */
  function initPalette() {
    const pal = $('.palette')
    if (!pal) return
    const input = $('input', pal)
    const items = () => $$('.pr-item', pal).filter((i) => !i.hidden)
    const select = (item) => { $$('.pr-item', pal).forEach((i) => i.setAttribute('aria-selected', String(i === item))); item?.scrollIntoView({ block: 'nearest' }) }
    const filter = () => {
      const q = input.value.trim().toLowerCase()
      $$('.pr-item', pal).forEach((i) => {
        const text = (i.dataset.search || i.textContent).toLowerCase()
        const scoped = i.dataset.when === 'query' ? q.length > 0 : true
        i.hidden = !scoped || (q && !text.includes(q))
      })
      $$('.pr-groupwrap', pal).forEach((g) => { g.hidden = $$('.pr-item', g).every((i) => i.hidden) })
      const empty = $('.pr-empty', pal)
      if (empty) { empty.hidden = items().length > 0; const qq = $('[data-empty-q]', empty); if (qq) qq.textContent = input.value }
      select(items()[0])
    }
    const open = () => { lastFocus = document.activeElement; pal.classList.add('open'); input.value = ''; filter(); input.focus() }
    window.mockOpenPalette = open
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.classList.contains('open') ? closeOverlays() : open() }
      if (!pal.classList.contains('open')) return
      const list = items()
      const idx = list.findIndex((i) => i.getAttribute('aria-selected') === 'true')
      if (e.key === 'ArrowDown') { e.preventDefault(); select(list[Math.min(idx + 1, list.length - 1)]) }
      if (e.key === 'ArrowUp') { e.preventDefault(); select(list[Math.max(idx - 1, 0)]) }
      if (e.key === 'Enter' && list[idx]) { e.preventDefault(); list[idx].click() }
    })
    $$('[data-palette-open]').forEach((b) => b.addEventListener('click', open))
    input.addEventListener('input', filter)
    $$('.pr-item', pal).forEach((i) => i.addEventListener('mousemove', () => select(i)))
  }

  /* ---------- Peek cards (desktop pointer only) ---------- */
  function initPeek() {
    let timer = null
    let card = null
    const hide = () => { clearTimeout(timer); if (card) { card.classList.remove('open'); const c = card; setTimeout(() => c.remove(), 150); card = null } }
    const show = (link) => {
      const tpl = document.getElementById(link.dataset.peek)
      if (!tpl || isPhone() || window.matchMedia('(pointer: coarse)').matches) return
      hide()
      card = document.createElement('div')
      card.className = 'peek'
      card.setAttribute('role', 'tooltip')
      card.appendChild(tpl.content.cloneNode(true))
      const f = frame()
      f.appendChild(card)
      icons()
      const fr = f.getBoundingClientRect()
      const lr = link.getBoundingClientRect()
      let left = lr.left - fr.left
      left = Math.min(left, fr.width - 316)
      let top = lr.bottom - fr.top + 6
      if (top + card.offsetHeight > fr.height - 8) { top = lr.top - fr.top - card.offsetHeight - 6; card.style.transformOrigin = 'bottom left' }
      card.style.left = `${Math.max(8, left)}px`
      card.style.top = `${top}px`
      requestAnimationFrame(() => card && card.classList.add('open'))
      card.addEventListener('mouseenter', () => clearTimeout(timer))
      card.addEventListener('mouseleave', () => { timer = setTimeout(hide, 150) })
    }
    document.addEventListener('mouseover', (e) => {
      const link = e.target.closest('[data-peek]')
      if (!link) return
      clearTimeout(timer)
      timer = setTimeout(() => show(link), card ? 0 : 300)
    })
    document.addEventListener('mouseout', (e) => {
      const link = e.target.closest('[data-peek]')
      if (link && !link.contains(e.relatedTarget)) { clearTimeout(timer); timer = setTimeout(hide, 150) }
    })
    document.addEventListener('focusin', (e) => { const l = e.target.closest('[data-peek]'); if (l) { clearTimeout(timer); timer = setTimeout(() => show(l), 300) } })
    document.addEventListener('focusout', (e) => { if (e.target.closest('[data-peek]')) hide() })
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide() })
  }

  /* ---------- Panes, selection, switches, misc ---------- */
  function initMisc() {
    document.addEventListener('click', (e) => {
      const paneOpen = e.target.closest('[data-pane-open]')
      if (paneOpen) {
        const panes = paneOpen.closest('[data-panes]')
        if (panes) { panes.dataset.view = 'detail'; const d = $('[data-pane="detail"]', panes); if (d) d.scrollTop = 0; const m = $('.main'); if (m && isPhone()) m.scrollTop = 0 }
      }
      const paneBack = e.target.closest('[data-pane-back]')
      if (paneBack) { const panes = paneBack.closest('[data-panes]'); if (panes) panes.dataset.view = 'list' }

      const sel = e.target.closest('[data-select-group] [data-selectable]')
      if (sel) {
        const group = sel.closest('[data-select-group]')
        $$('[data-selectable]', group).forEach((r) => r.setAttribute('aria-selected', String(r === sel)))
      }

      const sw = e.target.closest('.switch')
      if (sw) {
        const on = sw.getAttribute('aria-checked') !== 'true'
        sw.setAttribute('aria-checked', String(on))
        if (sw.dataset.onText && sw.dataset.target) {
          $$(sw.dataset.target).forEach((t) => { t.textContent = on ? sw.dataset.onText : sw.dataset.offText })
        }
        sw.dispatchEvent(new CustomEvent('mock:switch', { bubbles: true, detail: { on } }))
      }

      const show = e.target.closest('[data-show], [data-hide]')
      if (show) {
        if (show.dataset.show) $$(show.dataset.show).forEach((el) => { el.hidden = false; el.classList.remove('insert-in'); void el.offsetWidth; el.classList.add('insert-in') })
        if (show.dataset.hide) $$(show.dataset.hide).forEach((el) => { el.hidden = true })
        icons()
      }
      const hl = e.target.closest('[data-highlight]')
      if (hl) {
        const target = $(hl.dataset.highlight)
        if (target) {
          target.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
          target.classList.remove('highlight'); void target.offsetWidth; target.classList.add('highlight')
          setTimeout(() => target.classList.remove('highlight'), 2000)
        }
      }
    })
    $$('a[href="#"]').forEach((a) => a.addEventListener('click', (e) => e.preventDefault()))
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildReviewBar()
    initTabs()
    initSwitchGroups()
    initAccordions()
    initFilters()
    initOverlays()
    initToasts()
    initPalette()
    initPeek()
    initMisc()
    icons()
    document.dispatchEvent(new Event('mock:ready'))
  })
})()
