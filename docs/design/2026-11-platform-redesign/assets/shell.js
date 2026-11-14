/*
 * Mockup app shell: sidebar, phone top bar, bottom tabs and the command palette,
 * generated from one nav config per role plus the enabled features. This is the
 * shape proposed for C-3 / T-7 / S-5: a disabled feature has no nav item, no
 * Today card and no empty page.
 */
(function () {
  const FEATURES_DEFAULT = {
    student: ['updates', 'recordings', 'office_hours', 'help_requests'],
    instructor: ['updates', 'recordings', 'office_hours', 'meetings', 'help_requests', 'follow_ups'],
    admin: ['updates', 'recordings', 'office_hours', 'meetings', 'help_requests', 'follow_ups', 'catalog'],
  }

  const NAV = {
    student: {
      primary: [
        { key: 'today', label: 'Today', icon: 'sun', href: '07-student-today.html' },
        { key: 'learn', label: 'Learn', icon: 'book-open', href: '08-learn.html' },
        { key: 'mywork', label: 'My work', icon: 'clipboard-check', href: '11-my-work.html', count: 1 },
        { key: 'messages', label: 'Messages', icon: 'message-circle', href: '12-messages.html?variant=student', count: 1 },
        { key: 'updates', label: 'Updates', icon: 'megaphone', href: '#', feature: 'updates' },
        { key: 'recordings', label: 'Recordings', icon: 'clapperboard', href: '#', feature: 'recordings' },
        { key: 'office_hours', label: 'Office hours', icon: 'calendar-clock', href: '#', feature: 'office_hours' },
        { key: 'community', label: 'Course community', icon: 'users-round', href: '#', feature: 'community' },
      ],
      tabs: ['today', 'learn', 'mywork', 'messages'],
      user: { initials: 'BC', name: 'Blair Cruz', role: 'Cohort 3' },
    },
    instructor: {
      primary: [
        { key: 'today', label: 'Today', icon: 'sun', href: '04-instructor-today.html' },
        { key: 'cohorts', label: 'Cohorts', icon: 'layers', href: '13-setup-wizard.html' },
        { key: 'students', label: 'Students', icon: 'users', href: '06-student-workspace.html' },
        { key: 'grading', label: 'Grading', icon: 'clipboard-check', href: '05-grading.html', count: 9 },
        { key: 'support', label: 'Support', icon: 'life-buoy', href: '04-instructor-today.html', count: 2, feature: 'help_requests' },
        { key: 'content', label: 'Content', icon: 'library', href: '02-content-library.html' },
        { key: 'messages', label: 'Messages', icon: 'message-circle', href: '12-messages.html', count: 2 },
      ],
      more: [
        { key: 'updates', label: 'Updates', icon: 'megaphone', href: '#', feature: 'updates' },
        { key: 'recordings', label: 'Recordings', icon: 'clapperboard', href: '#', feature: 'recordings' },
        { key: 'meetings', label: 'Meetings', icon: 'calendar-days', href: '#', feature: 'meetings' },
        { key: 'office_hours', label: 'Office hours', icon: 'calendar-clock', href: '#', feature: 'office_hours' },
      ],
      tabs: ['today', 'grading', 'support', 'messages'],
      user: { initials: 'AU', name: 'Audreana', role: 'Instructor' },
    },
    admin: {
      primary: [
        { key: 'today', label: 'Today', icon: 'sun', href: '04-instructor-today.html' },
        { key: 'cohorts', label: 'Cohorts', icon: 'layers', href: '13-setup-wizard.html' },
        { key: 'students', label: 'Students', icon: 'users', href: '06-student-workspace.html' },
        { key: 'grading', label: 'Grading', icon: 'clipboard-check', href: '05-grading.html', count: 9 },
        { key: 'support', label: 'Support', icon: 'life-buoy', href: '04-instructor-today.html', count: 2, feature: 'help_requests' },
        { key: 'content', label: 'Content', icon: 'library', href: '02-content-library.html' },
        { key: 'messages', label: 'Messages', icon: 'message-circle', href: '12-messages.html', count: 2 },
      ],
      more: [
        { key: 'updates', label: 'Updates', icon: 'megaphone', href: '#', feature: 'updates' },
        { key: 'recordings', label: 'Recordings', icon: 'clapperboard', href: '#', feature: 'recordings' },
        { key: 'meetings', label: 'Meetings', icon: 'calendar-days', href: '#', feature: 'meetings' },
        { key: 'catalog', label: 'Catalog', icon: 'store', href: '13-setup-wizard.html', feature: 'catalog' },
        { key: 'team', label: 'Team', icon: 'id-card', href: '#' },
        { key: 'safety', label: 'Safety', icon: 'shield', href: '#' },
        { key: 'settings', label: 'School settings', icon: 'settings', href: '01-app-shell.html?variant=admin' },
      ],
      tabs: ['today', 'grading', 'support', 'messages'],
      user: { initials: 'LS', name: 'Leon Shimizu', role: 'Admin' },
    },
  }

  const PALETTE = {
    staff: [
      { group: 'Students', icon: 'user', title: 'Alex Rivera', sub: 'Cohort 3 · 155 of 243 lessons · 1 waiting for review', type: 'Student', href: '06-student-workspace.html', acts: ['Message'] },
      { group: 'Students', icon: 'user', title: 'Blair Cruz', sub: 'Cohort 3 · About 3 weeks behind', type: 'Student', href: '06-student-workspace.html', acts: ['Message'] },
      { group: 'Students', icon: 'user', title: 'Eli Santos', sub: 'Python Fundamentals (self-paced) · started today', type: 'Student', href: '06-student-workspace.html', acts: ['Message'] },
      { group: 'Lessons', icon: 'file-text', title: 'Make Decisions with JavaScript', sub: 'Web Development Bootcamp › JavaScript Foundations › Week 10, Mon', type: 'Lesson', href: '03-lesson-editor.html', acts: ['Edit', 'Preview'] },
      { group: 'Lessons', icon: 'file-text', title: 'Loops and Iteration', sub: 'Web Development Bootcamp › JavaScript Foundations › Week 10, Wed', type: 'Lesson', href: '03-lesson-editor.html', acts: ['Edit', 'Preview'] },
      { group: 'Lessons', icon: 'file-text', title: 'Variables and Types', sub: 'Python Fundamentals › Getting Started › Lesson 3', type: 'Lesson', href: '03-lesson-editor.html', acts: ['Edit', 'Preview'] },
      { group: 'Work', icon: 'clipboard-check', title: 'Submission #812 · Alex Rivera', sub: 'Make Decisions with JavaScript · waiting 2 days', type: 'Submission', href: '05-grading.html', acts: ['Grade'] },
      { group: 'Work', icon: 'life-buoy', title: 'Help request · Blair Cruz', sub: '“My loop never stops”, Loops and Iteration · 3 h ago', type: 'Help request', href: '04-instructor-today.html', acts: ['Reply'] },
      { group: 'Cohorts', icon: 'layers', title: 'Cohort 3', sub: 'Live program · 6 students · Week 11', type: 'Cohort', href: '13-setup-wizard.html' },
      { group: 'Cohorts', icon: 'layers', title: 'Python Fundamentals (self-paced)', sub: 'Self-paced · 3 learners', type: 'Cohort', href: '13-setup-wizard.html' },
      { group: 'Cohorts', icon: 'library', title: 'CSG Alumni', sub: 'Library · 11 members', type: 'Cohort', href: '13-setup-wizard.html' },
      { group: 'Go to', icon: 'clipboard-check', title: 'Grading', sub: 'Page', type: 'Page', href: '05-grading.html' },
      { group: 'Go to', icon: 'library', title: 'Content', sub: 'Page', type: 'Page', href: '02-content-library.html' },
      { group: 'Go to', icon: 'life-buoy', title: 'Support', sub: 'Page', type: 'Page', href: '04-instructor-today.html' },
      { group: 'Actions', icon: 'plus', title: 'New cohort', sub: 'Action', type: 'Action', href: '13-setup-wizard.html' },
      { group: 'Actions', icon: 'megaphone', title: 'Post update', sub: 'Action', type: 'Action', href: '#' },
    ],
    student: [
      { group: 'Lessons', icon: 'file-text', title: 'Make Decisions with JavaScript', sub: 'Week 10 · Done', type: 'Lesson', href: '09-lesson.html' },
      { group: 'Lessons', icon: 'file-text', title: 'Loops and Iteration', sub: 'Week 10 · Next up', type: 'Lesson', href: '09-lesson.html' },
      { group: 'Lessons', icon: 'file-text', title: 'Functions Recap', sub: 'Week 9 · Redo requested', type: 'Lesson', href: '09-lesson.html' },
      { group: 'Recordings', icon: 'clapperboard', title: 'Live class: Conditionals walkthrough', sub: 'Week 10 · 52 min', type: 'Recording', href: '#' },
      { group: 'Resources', icon: 'folder', title: 'JavaScript cheat sheet', sub: 'PDF · Cohort 3 resources', type: 'Resource', href: '#' },
      { group: 'Messages', icon: 'message-circle', title: 'Audreana', sub: '“Nice work on the conditionals exercise…”', type: 'Message', href: '12-messages.html?variant=student' },
      { group: 'Go to', icon: 'clipboard-check', title: 'My work', sub: 'Page', type: 'Page', href: '11-my-work.html' },
      { group: 'Go to', icon: 'book-open', title: 'Learn', sub: 'Page', type: 'Page', href: '08-learn.html' },
    ],
  }

  const icon = (name) => `<i data-lucide="${name}"></i>`

  function build(app, withPalette = true) {
    const role = app.dataset.shell
    const cfg = NAV[role]
    if (!cfg) return
    const features = (app.dataset.features ?? FEATURES_DEFAULT[role].join(' ')).split(' ').filter(Boolean)
    const enabled = (item) => !item.feature || features.includes(item.feature)
    const active = app.dataset.active
    const main = app.querySelector('.main')

    const navLink = (item) => `<a href="${item.href}" ${item.key === active ? 'aria-current="page"' : ''}>${icon(item.icon)}<span>${item.label}</span>${item.count ? `<span class="count">${item.count}</span>` : ''}</a>`
    const primary = cfg.primary.filter(enabled)
    const more = (cfg.more || []).filter(enabled)
    const [uInit, uName, uRole] = (app.dataset.user || '').split('|')
    const user = app.dataset.user ? { initials: uInit, name: uName, role: uRole } : cfg.user
    const switcher = app.dataset.switcher
      ? `<button type="button" class="sb-search" style="color:var(--csg-ink);font-weight:700" data-popover="ws-pop" aria-expanded="false">${icon('graduation-cap')}<span class="truncate">${app.dataset.switcher}</span><i data-lucide="chevrons-up-down" style="margin-left:auto"></i></button>`
      : ''

    const sidebar = document.createElement('aside')
    sidebar.className = 'sidebar'
    sidebar.innerHTML = `
      <div class="hstack" style="padding-right:10px"><a class="sb-brand" href="index.html"><span class="logo">CSG</span>CSG Learn</a><span class="spacer"></span>
        <button class="btn btn-ghost btn-icon btn-sm" aria-label="Notifications" data-toast="Notifications open here (L-2.9)">${icon('bell')}</button></div>
      ${switcher}
      <button type="button" class="sb-search" data-palette-open>${icon('search')}<span>Search</span><kbd>⌘K</kbd></button>
      <nav class="nav" aria-label="Main">${primary.map(navLink).join('')}
        ${more.length ? `<div class="nav-label">More</div>${more.map(navLink).join('')}` : ''}
      </nav>
      <div class="sb-foot" style="position:relative">
        <span class="avatar">${user.initials}</span><div class="who"><b>${user.name}</b><span>${user.role}</span></div>
        <button class="btn btn-ghost btn-icon btn-sm" style="margin-left:auto" aria-label="Account and theme" data-popover="acct-pop" aria-expanded="false">${icon('ellipsis')}</button>
        <div class="popover" id="acct-pop" hidden style="bottom:52px;left:12px;--origin:bottom left;width:224px">
          <a class="menu-item" href="#">${icon('user')}Profile</a>
          <div class="menu-sep"></div>
          <div class="xs muted" style="padding:6px 10px 4px;font-weight:700">Theme</div>
          <div class="seg" role="group" aria-label="Theme" data-rb="theme" style="margin:0 6px 6px">
            <button type="button" data-v="light">${icon('sun')}</button><button type="button" data-v="dark">${icon('moon')}</button><button type="button" data-v="system">${icon('monitor')}<span>System</span></button>
          </div>
          <div class="menu-sep"></div>
          <a class="menu-item" href="#">${icon('log-out')}Sign out</a>
        </div>
      </div>
      ${app.dataset.switcher ? `<div class="popover" id="ws-pop" hidden style="top:108px;left:12px;--origin:top left;width:224px">
          <a class="menu-item" aria-selected="true" href="07-student-today.html">${icon('check')}Cohort 3</a>
          <a class="menu-item" href="08-learn.html?variant=library">${icon('library')}CSG Alumni library</a>
        </div>` : ''}`
    app.insertBefore(sidebar, main)

    if (!main.querySelector(':scope > .topbar')) {
      const top = document.createElement('header')
      top.className = 'topbar'
      top.innerHTML = `<span class="logo">CSG</span><span class="tb-title">${app.dataset.phoneTitle || ''}</span>
        <button class="btn btn-ghost btn-icon" aria-label="Search" data-palette-open>${icon('search')}</button>
        <button class="btn btn-ghost btn-icon" aria-label="Notifications" data-toast="Notifications">${icon('bell')}</button>`
      main.prepend(top)
    }

    const all = [...cfg.primary, ...(cfg.more || [])]
    const tabs = document.createElement('nav')
    tabs.className = 'tabbar'
    tabs.setAttribute('aria-label', 'Main')
    tabs.innerHTML = cfg.tabs.map((k) => all.find((i) => i.key === k)).filter(Boolean).filter(enabled).map((item) =>
      `<a href="${item.href}" ${item.key === active ? 'aria-current="page"' : ''}>${icon(item.icon)}${item.count ? '<span class="dot primary"></span>' : ''}<span>${item.label}</span></a>`).join('') +
      `<a href="#" data-open="more-sheet">${icon('menu')}<span>More</span></a>`
    // Tab bar sits inside the column layout on phones.
    app.appendChild(tabs)

    const moreItems = [...cfg.primary.filter((i) => !cfg.tabs.includes(i.key)), ...more].filter(enabled)
    const sheet = document.createElement('div')
    sheet.className = 'overlay'
    sheet.id = 'more-sheet'
    sheet.innerHTML = `<div class="scrim"></div><div class="drawer" role="dialog" aria-label="More">
      <div class="drawer-head"><b>More</b><span class="spacer"></span><button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="drawer-body"><nav class="nav" style="padding:0">${moreItems.map(navLink).join('')}<div class="menu-sep"></div>
      <a href="#">${icon('user')}<span>Profile</span></a></nav>
      <div class="xs muted" style="font-weight:700;margin:14px 0 6px">Theme</div>
      <div class="seg" role="group" aria-label="Theme" data-rb="theme"><button type="button" data-v="light">${icon('sun')}<span>Light</span></button><button type="button" data-v="dark">${icon('moon')}<span>Dark</span></button><button type="button" data-v="system">${icon('monitor')}<span>System</span></button></div>
      </div></div>`
    app.closest('.frame').appendChild(sheet)

    if (!withPalette) return
    const results = PALETTE[role === 'student' ? 'student' : 'staff']
    const groups = [...new Set(results.map((r) => r.group))]
    const pal = document.createElement('div')
    pal.className = 'palette'
    pal.innerHTML = `<div class="scrim"></div><div class="palette-box" role="dialog" aria-label="Search">
      <div class="palette-input">${icon('search')}<input type="text" aria-label="Search" placeholder="${role === 'student' ? 'Search lessons, recordings, messages' : 'Search students, lessons, cohorts, work'}"><button class="btn btn-ghost btn-sm show-phone" data-close>Cancel</button><kbd class="hide-phone">esc</kbd></div>
      <div class="palette-results" role="listbox">
        ${groups.map((g) => `<div class="pr-groupwrap"><div class="pr-group">${g}</div>${results.filter((r) => r.group === g).map((r) => `
          <a class="pr-item" role="option" href="${r.href}" data-search="${r.title} ${r.sub} ${r.type}">
            <span class="pr-icon">${icon(r.icon)}</span>
            <span class="pr-text"><b>${r.title}</b><span>${r.sub}</span></span>
            ${r.acts ? `<span class="pr-acts">${r.acts.map((a) => `<span class="btn btn-secondary btn-sm">${a}</span>`).join('')}</span>` : ''}
            <span class="pr-type">${r.type}</span>
          </a>`).join('')}</div>`).join('')}
        <div class="empty pr-empty" hidden><div class="e-icon">${icon('search-x')}</div><b>No results for “<span data-empty-q></span>”</b><p>Search covers ${role === 'student' ? 'lessons, recordings, resources and messages' : 'students, lessons, cohorts, submissions, help requests and pages'}.</p></div>
      </div>
      <div class="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>⌘</kbd> <kbd>↵</kbd> open in new tab</span></div>
    </div>`
    app.closest('.frame').appendChild(pal)

  }

  // Theme buttons inside the app share the review bar's handler.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.sidebar [data-rb="theme"] button, #more-sheet [data-rb="theme"] button')
    if (b) document.querySelector(`.review-bar [data-rb="theme"] button[data-v="${b.dataset.v}"]`)?.click()
  })

  window.mockBuildShell = (app) => {
    app.querySelectorAll(':scope > .sidebar, :scope > .tabbar').forEach((el) => el.remove())
    const f = app.closest('.frame')
    f.querySelectorAll(':scope > #more-sheet').forEach((el) => el.remove())
    build(app, false)
    window.lucide?.createIcons()
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.app[data-shell]').forEach((app) => build(app))
  })
})()
