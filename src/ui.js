import {
  USERS,
  MONTH_NAMES,
  MONTH_SHORT,
  DAY_NAMES,
  DAY_SHORT,
  SYNC_INTERVAL_MS,
  state,
  getEvents,
  setEvents,
  startOfDay,
  isSameDay,
  dateKey,
  addDays,
  formatTimeReadable,
  getRollingDays,
  getMondayOfWeek,
} from './state.js';
import { fetchCalendarEvents } from './api-client.js';

let syncTimer = null;
let midnightTimer = null;

function normalizeEvents(rawEvents) {
  return rawEvents.map(e => {
    const user = USERS.find(u => u.id === e.userId) || null;
    return {
      id: e.id,
      summary: e.summary || 'Untitled',
      label: e.label || e.summary || 'Untitled',
      start: new Date(e.start),
      end: new Date(e.end),
      user,
      allDay: !!e.allDay,
    };
  });
}

function getEventsForDay(day, userId = null) {
  const key = dateKey(day);
  return getEvents()
    .filter(e => {
      const eDay = startOfDay(e.start);
      if (dateKey(eDay) !== key) return false;
      if (userId && (!e.user || e.user.id !== userId)) return false;
      if (state.filteredUser && (!e.user || e.user.id !== state.filteredUser)) return false;
      return true;
    })
    .sort((a, b) => a.start - b.start);
}

function getEventsForUserOnDay(userId, day) {
  const key = dateKey(day);
  return getEvents()
    .filter(e => e.user && e.user.id === userId && dateKey(startOfDay(e.start)) === key)
    .sort((a, b) => a.start - b.start);
}

async function syncCalendarData() {
  const result = await fetchCalendarEvents();
  const normalized = normalizeEvents(result.events);
  setEvents(normalized);
  updateLastSynced(new Date(), result.fromCache ? 'Offline cache' : undefined);
  renderCurrentView();
}

function updateLastSynced(date, overrideText) {
  const text = overrideText || (date
    ? `Last updated ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : 'Last updated -');

  const ids = ['last-updated', 'last-updated-mobile', 'sidebar-last-updated'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
}

function startSyncLoop() {
  syncCalendarData();
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(syncCalendarData, SYNC_INTERVAL_MS);
}

function scheduleMidnightRollover() {
  if (midnightTimer) clearTimeout(midnightTimer);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 1, 0);
  midnightTimer = setTimeout(() => {
    if (!state.anchoredFromMonth) {
      state.weekStartDate = startOfDay(new Date());
    }
    state.selectedDate = startOfDay(new Date());
    renderCurrentView();
    scheduleMidnightRollover();
  }, tomorrow - now);
}

function showView(name) {
  state.view = name;
  document.querySelectorAll('.view-container').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById(`view-${name}`);
  if (target) target.classList.remove('hidden');
  renderCurrentView();
}

function renderCurrentView() {
  if (state.view === 'week') renderWeekView();
  if (state.view === 'day') renderDayView();
  if (state.view === 'month') renderMonthView();
  renderSidebar();
}

function isMobileSidebar() {
  return window.innerWidth < 768;
}

function applySidebarState() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;

  sidebar.classList.toggle('is-pinned', state.sidebarPinned);

  if (isMobileSidebar()) {
    sidebar.classList.toggle('is-mobile-open', state.sidebarOpen);
    backdrop?.classList.toggle('is-visible', state.sidebarOpen);
    document.body.classList.toggle('overflow-hidden', state.sidebarOpen);
  } else {
    sidebar.classList.remove('is-mobile-open');
    backdrop?.classList.remove('is-visible');
    document.body.classList.remove('overflow-hidden');
  }
}

function setSidebarOpen(open) {
  state.sidebarOpen = open;
  applySidebarState();
}

function toggleSidebarPin() {
  state.sidebarPinned = !state.sidebarPinned;
  try {
    localStorage.setItem('glance-sidebar-pinned', state.sidebarPinned ? '1' : '0');
  } catch {
    /* ignore */
  }
  applySidebarState();
}

function toggleSidebar() {
  if (isMobileSidebar()) {
    setSidebarOpen(!state.sidebarOpen);
  } else {
    toggleSidebarPin();
  }
}

function maybeCloseSidebarOnMobile() {
  if (window.innerWidth < 768 && state.sidebarOpen) setSidebarOpen(false);
}

function renderSidebar() {
  document.querySelectorAll('.sidebar-nav-item-view').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.nav === state.view);
  });

  const filtersEl = document.getElementById('sidebar-user-filters');
  if (!filtersEl) return;

  filtersEl.innerHTML = USERS.map(user => {
    const active = state.filteredUser === user.id;
    const initial = user.name.charAt(0);
    return `
      <button type="button" data-user-filter="${user.id}"
        class="sidebar-user-item ${active ? 'is-active' : ''}">
        <span class="sidebar-user-dot ${user.dot} text-white">${initial}</span>
        <span class="sidebar-label">${user.name}</span>
      </button>`;
  }).join('');

  bindUserFilterButtons(filtersEl);
}

function clearFilters() {
  state.filteredUser = null;
  state.anchoredFromMonth = false;
  state.weekStartDate = startOfDay(new Date());
  renderCurrentView();
}

function userBadgeHTML(user, options = {}) {
  const { active = false, compact = false, onClick = true } = options;
  const activeRing = active ? 'ring-2 ring-offset-2 ring-zinc-400' : '';
  const size = compact ? 'px-3 py-2 text-sm' : 'px-4 py-3 text-base sm:text-lg';
  const click = onClick ? `data-user-filter="${user.id}"` : '';
  return `
    <button type="button" ${click}
      class="touch-target user-badge ${size} rounded-2xl font-semibold ${user.bg} ${user.border} ${user.text} border shadow-sm hover:shadow-md active:scale-[0.97] transition-all ${activeRing} whitespace-nowrap">
      ${user.name}
    </button>`;
}

function bindUserFilterButtons(container) {
  container.querySelectorAll('[data-user-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.userFilter;
      state.filteredUser = state.filteredUser === id ? null : id;
      renderCurrentView();
    });
  });
}

function stripUserPrefix(summary) {
  let s = summary;
  for (const u of USERS) {
    for (const kw of u.keywords) {
      s = s.replace(new RegExp(kw, 'gi'), '').trim();
    }
  }
  return s.replace(/^[-:,\s]+/, '').trim() || summary;
}

function bindDayLinks(container) {
  container.querySelectorAll('[data-day-link]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [y, m, d] = btn.dataset.dayLink.split('-').map(Number);
      state.selectedDate = new Date(y, m - 1, d);
      showView('day');
    });
  });
}

function renderWeekView() {
  const days = getRollingDays(state.weekStartDate);
  const monthLabel = document.getElementById('week-month-label');
  monthLabel.textContent = MONTH_NAMES[days[0].getMonth()];

  const today = new Date();
  const headersEl = document.getElementById('week-day-headers');
  headersEl.innerHTML = `
    <div class="flex items-center justify-center text-xs sm:text-sm font-semibold text-zinc-400 py-2"></div>
    ${days.map(day => {
      const isToday = isSameDay(day, today);
      return `
        <button type="button" data-day-link="${dateKey(day)}"
          class="touch-target day-cell-header flex flex-col items-center justify-center py-2 sm:py-3 rounded-xl ${isToday ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-700'} shadow-sm hover:shadow-md active:scale-[0.97] transition-all">
          <span class="text-[10px] sm:text-xs font-medium opacity-80">${DAY_SHORT[day.getDay()]}</span>
          <span class="text-lg sm:text-xl font-bold">${day.getDate()}</span>
        </button>`;
    }).join('')}
  `;

  const matrixEl = document.getElementById('week-matrix');
  matrixEl.innerHTML = USERS.map(user => {
    const dimmed = state.filteredUser && state.filteredUser !== user.id ? 'lane-dimmed' : '';
    const active = state.filteredUser === user.id;
    return `
      <div class="week-row grid grid-cols-8 gap-1 sm:gap-2 ${dimmed} stagger-item" data-user-row="${user.id}">
        <div class="flex items-center justify-center p-1">
          ${userBadgeHTML(user, { active, compact: true })}
        </div>
        ${days.map(day => {
          const dayEvents = getEventsForUserOnDay(user.id, day);
          const preview = dayEvents.slice(0, 3).map(e => `
            <div class="truncate text-[10px] sm:text-xs font-medium ${user.text} leading-tight">${e.allDay ? 'All day' : formatTimeReadable(e.start)} ${escapeHtml(stripUserPrefix(e.summary))}</div>
          `).join('');
          const more = dayEvents.length > 3 ? `<div class="text-[10px] text-zinc-400 font-medium">+${dayEvents.length - 3} more</div>` : '';
          return `
            <button type="button" data-day-link="${dateKey(day)}"
              class="touch-target day-cell min-h-[4.5rem] sm:min-h-[5.5rem] p-2 sm:p-3 rounded-xl bg-white border border-zinc-200 shadow-sm hover:shadow-md active:scale-[0.98] transition-all text-left overflow-hidden elevate-hover">
              <div class="space-y-0.5">${preview}${more}</div>
              ${dayEvents.length === 0 ? '<div class="h-full flex items-center justify-center text-zinc-300 text-xs">-</div>' : ''}
            </button>`;
        }).join('')}
      </div>`;
  }).join('');

  bindUserFilterButtons(matrixEl);
  bindDayLinks(headersEl);
  bindDayLinks(matrixEl);
  applyStagger('#week-matrix', '.stagger-item');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderDayView() {
  const day = state.selectedDate;
  document.getElementById('day-name-label').textContent = DAY_NAMES[day.getDay()];
  document.getElementById('day-date-sub').textContent = `${MONTH_NAMES[day.getMonth()]} ${day.getDate()}, ${day.getFullYear()}`;

  const strips = ['day-user-strip', 'day-user-strip-mobile'];
  strips.forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = USERS.map(u => userBadgeHTML(u, { active: state.filteredUser === u.id, compact: id.includes('mobile') })).join('');
    bindUserFilterButtons(el);
  });

  const timeline = document.getElementById('day-timeline');
  const dayEvents = getEventsForDay(day);

  if (dayEvents.length === 0) {
    timeline.innerHTML = `
      <div class="flex flex-col items-center justify-center py-20 text-zinc-400">
        <p class="text-lg font-medium">No events scheduled</p>
      </div>`;
    return;
  }

  timeline.innerHTML = dayEvents.map(e => {
    const user = e.user;
    const uStyle = user ? `${user.bg} ${user.border} ${user.text}` : 'bg-white border-zinc-200 text-zinc-700';
    const timeStr = e.allDay ? 'All day' : formatTimeReadable(e.start);
    const label = stripUserPrefix(e.summary);
    return `
      <div class="rounded-2xl border shadow-sm p-5 sm:p-6 ${uStyle} transition-all elevate-hover stagger-item">
        <p class="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight leading-tight">
          <span class="text-zinc-500 font-semibold text-xl sm:text-2xl md:text-3xl mr-2">${timeStr}</span>
          ${escapeHtml(label)}
        </p>
        ${user ? `<p class="mt-2 text-sm font-semibold opacity-70">${user.name}</p>` : ''}
      </div>`;
  }).join('');

  applyStagger('#day-timeline', '.stagger-item');
}

function renderMonthRibbon() {
  const ribbon = document.getElementById('month-ribbon');
  ribbon.innerHTML = MONTH_SHORT.map((label, i) => {
    const isActive = state.selectedMonth === i;
    return `
      <button type="button" data-month="${i}"
        class="touch-target flex-shrink-0 px-3 sm:px-4 py-2.5 rounded-xl text-sm sm:text-base font-semibold transition-all active:scale-[0.97]
          ${isActive ? 'bg-zinc-900 text-white shadow-md' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50 shadow-sm'}">
        ${label}
      </button>`;
  }).join('');

  ribbon.querySelectorAll('[data-month]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedMonth = parseInt(btn.dataset.month, 10);
      renderMonthView();
    });
  });
}

function navigateToWeekFromMonth(weekNum) {
  const firstOfMonth = new Date(state.selectedYear, state.selectedMonth, 1);
  const firstMonday = getMondayOfWeek(firstOfMonth);
  state.weekStartDate = addDays(firstMonday, (weekNum - 1) * 7);
  state.anchoredFromMonth = true;
  showView('week');
}

function renderWeekStrips() {
  const weekBtn = n => `
    <button type="button" data-week="${n}"
      class="touch-target px-4 py-3 rounded-xl bg-white border border-zinc-200 shadow-sm text-sm font-bold text-zinc-700 hover:shadow-md active:scale-[0.97] transition-all whitespace-nowrap">
      Week ${n}
    </button>`;

  ['month-week-strip', 'month-week-strip-mobile'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = [1, 2, 3, 4, 5].map(weekBtn).join('');
    el.querySelectorAll('[data-week]').forEach(btn => {
      btn.addEventListener('click', () => navigateToWeekFromMonth(parseInt(btn.dataset.week, 10)));
    });
  });
}

function renderUserStrips() {
  ['month-user-strip', 'month-user-strip-mobile'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = USERS.map(u => userBadgeHTML(u, { active: state.filteredUser === u.id, compact: id.includes('mobile') })).join('');
    bindUserFilterButtons(el);
  });
}

function renderMonthGrid() {
  const grid = document.getElementById('month-grid');
  const firstDay = new Date(state.selectedYear, state.selectedMonth, 1);
  const startMonday = getMondayOfWeek(firstDay);

  const cells = [];
  let cursor = new Date(startMonday);

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 7; col++) {
      const inMonth = cursor.getMonth() === state.selectedMonth;
      const dayEvents = inMonth ? getEventsForDay(cursor) : [];
      const indicators = dayEvents.slice(0, 4).map(e => {
        const dot = e.user ? e.user.dot : 'bg-zinc-300';
        return `<div class="h-1 rounded-full ${dot} flex-1 min-w-[8px] max-w-[24px]"></div>`;
      }).join('');

      cells.push(`
        <button type="button" data-day-link="${dateKey(cursor)}" ${!inMonth ? 'disabled' : ''}
          class="touch-target min-h-[3.5rem] sm:min-h-[5rem] p-2 rounded-xl transition-all text-left
            ${inMonth ? 'bg-white border border-zinc-200 shadow-sm hover:shadow-md active:scale-[0.97] cursor-pointer elevate-hover' : 'bg-transparent border border-transparent opacity-30 cursor-default'}
            ${isSameDay(cursor, new Date()) && inMonth ? 'ring-2 ring-zinc-900 ring-offset-1' : ''}">
          <span class="text-sm sm:text-base font-bold ${inMonth ? 'text-zinc-800' : 'text-zinc-400'}">${cursor.getDate()}</span>
          ${inMonth && indicators ? `<div class="flex gap-0.5 mt-1.5 flex-wrap">${indicators}</div>` : ''}
        </button>`);
      cursor = addDays(cursor, 1);
    }
  }

  grid.innerHTML = cells.join('');
  bindDayLinks(grid);
  applyStagger('#month-grid', 'button');
}

function renderMonthView() {
  renderMonthRibbon();
  renderWeekStrips();
  renderUserStrips();
  renderMonthGrid();
}

function applyStagger(containerSelector, itemSelector) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  const items = container.querySelectorAll(itemSelector);
  items.forEach((item, idx) => {
    item.style.animationDelay = `${Math.min(idx * 35, 280)}ms`;
  });
}

function initEventListeners() {
  document.querySelectorAll('[data-sidebar-toggle]').forEach(btn => {
    btn.addEventListener('click', toggleSidebar);
  });

  document.getElementById('sidebar-backdrop')?.addEventListener('click', () => setSidebarOpen(false));
  document.getElementById('btn-sidebar-pin')?.addEventListener('click', toggleSidebarPin);

  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.nav;
      if (target === 'day') state.selectedDate = startOfDay(new Date());
      if (target === 'month') {
        state.selectedMonth = state.selectedDate.getMonth();
        state.selectedYear = state.selectedDate.getFullYear();
      }
      if (target === 'week' && !state.anchoredFromMonth) {
        state.weekStartDate = startOfDay(new Date());
      }
      showView(target);
      maybeCloseSidebarOnMobile();
    });
  });

  const byId = id => document.getElementById(id);
  byId('btn-sidebar-clear')?.addEventListener('click', () => { clearFilters(); maybeCloseSidebarOnMobile(); });
  byId('btn-sidebar-sync')?.addEventListener('click', () => { syncCalendarData(); maybeCloseSidebarOnMobile(); });
  byId('btn-month-header')?.addEventListener('click', () => {
    state.selectedMonth = state.selectedDate.getMonth();
    state.selectedYear = state.selectedDate.getFullYear();
    showView('month');
  });
  byId('btn-back-week')?.addEventListener('click', () => { state.filteredUser = null; showView('week'); });
  byId('btn-clear-filters')?.addEventListener('click', clearFilters);
  byId('btn-month-clear-filters')?.addEventListener('click', clearFilters);

  window.addEventListener('resize', () => {
    if (!isMobileSidebar()) setSidebarOpen(false);
    applySidebarState();
  });
}

function loadDemoEvents() {
  const today = startOfDay(new Date());
  const demos = [
    { user: 'anna', dayOffset: 0, hour: 10, min: 0, title: 'Anna Speech Therapy' },
    { user: 'anna', dayOffset: 1, hour: 14, min: 0, title: 'Anna Try on dress' },
    { user: 'simeon', dayOffset: 0, hour: 9, min: 30, title: 'Simeon Soccer practice' },
    { user: 'simeon', dayOffset: 2, hour: 16, min: 0, title: 'Simeon Piano lesson' },
  ];

  const mapped = demos.map(d => {
    const start = addDays(today, d.dayOffset);
    start.setHours(d.hour, d.min, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    const user = USERS.find(u => u.id === d.user) || null;
    return { id: `demo-${d.user}-${d.dayOffset}-${d.hour}`, summary: d.title, label: d.title, start, end, user, allDay: false };
  });

  setEvents(mapped);
  updateLastSynced(new Date(), 'Demo data loaded');
  renderCurrentView();
}

async function init() {
  initEventListeners();
  try {
    state.sidebarPinned = localStorage.getItem('glance-sidebar-pinned') === '1';
  } catch {
    /* ignore */
  }
  setSidebarOpen(false);
  applySidebarState();
  showView('week');
  await syncCalendarData();
  if (getEvents().length === 0) {
    loadDemoEvents();
  }
  startSyncLoop();
  scheduleMidnightRollover();
}

document.addEventListener('DOMContentLoaded', init);
