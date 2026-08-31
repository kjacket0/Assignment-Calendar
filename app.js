(() => {
  'use strict';

  const STORAGE_KEY = 'ride-along-assignments-v1';
  const SUBJECT_PALETTE = [
    '#0f6266', '#a35d00', '#5b3fb6', '#b3261e',
    '#2e7d32', '#8e4585', '#00695c', '#6d4c00',
  ];

  /* ---------- storage ---------- */

  function loadAssignments() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      // Backfill updatedAt for data saved before sync existed.
      return list.map((a) => (a.updatedAt ? a : { ...a, updatedAt: Date.now() }));
    } catch {
      return [];
    }
  }

  function saveAssignments(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function visibleAssignments() {
    return assignments.filter((a) => !a.deleted);
  }

  let assignments = loadAssignments();

  /* ---------- helpers ---------- */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function subjectColor(subject) {
    let hash = 0;
    for (let i = 0; i < subject.length; i++) hash = (hash * 31 + subject.charCodeAt(i)) >>> 0;
    return SUBJECT_PALETTE[hash % SUBJECT_PALETTE.length];
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatTime(timeStr) {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    const dt = new Date(2000, 0, 1, h, m);
    return dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function isOverdue(a) {
    if (a.done) return false;
    return a.date < todayStr();
  }

  function uniqueSubjects() {
    return [...new Set(visibleAssignments().map((a) => a.subject))].sort((a, b) => a.localeCompare(b));
  }

  /* ---------- tabs ---------- */

  const tabChecklist = document.getElementById('tab-checklist');
  const tabCalendar = document.getElementById('tab-calendar');
  const viewChecklist = document.getElementById('view-checklist');
  const viewCalendar = document.getElementById('view-calendar');

  function showTab(name) {
    const isChecklist = name === 'checklist';
    tabChecklist.setAttribute('aria-selected', String(isChecklist));
    tabCalendar.setAttribute('aria-selected', String(!isChecklist));
    viewChecklist.hidden = !isChecklist;
    viewCalendar.hidden = isChecklist;
    if (!isChecklist) renderCalendar();
  }

  tabChecklist.addEventListener('click', () => showTab('checklist'));
  tabCalendar.addEventListener('click', () => showTab('calendar'));

  /* ---------- checklist view ---------- */

  const filterSubject = document.getElementById('filter-subject');
  const hideCompleted = document.getElementById('hide-completed');
  const checklistGroups = document.getElementById('checklist-groups');
  const checklistEmpty = document.getElementById('checklist-empty');

  function refreshSubjectOptions() {
    const subjects = uniqueSubjects();
    const current = filterSubject.value;
    filterSubject.innerHTML = '<option value="">All subjects</option>' +
      subjects.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    if (subjects.includes(current)) filterSubject.value = current;

    const datalist = document.getElementById('subject-list');
    datalist.innerHTML = subjects.map((s) => `<option value="${escapeHtml(s)}">`).join('');
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderChecklist() {
    refreshSubjectOptions();
    const subjectFilter = filterSubject.value;
    const hideDone = hideCompleted.checked;

    const visible = visibleAssignments();
    let list = visible;
    if (subjectFilter) list = list.filter((a) => a.subject === subjectFilter);
    if (hideDone) list = list.filter((a) => !a.done);

    checklistGroups.innerHTML = '';
    checklistEmpty.hidden = visible.length > 0;

    if (list.length === 0) {
      checklistGroups.innerHTML = visible.length
        ? '<p class="empty-state">Nothing to show here.</p>'
        : '';
      return;
    }

    const bySubject = new Map();
    for (const a of list) {
      if (!bySubject.has(a.subject)) bySubject.set(a.subject, []);
      bySubject.get(a.subject).push(a);
    }

    const subjects = [...bySubject.keys()].sort((a, b) => a.localeCompare(b));
    for (const subject of subjects) {
      const items = bySubject.get(subject).sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
      });

      const group = document.createElement('div');
      group.className = 'subject-group';
      const color = subjectColor(subject);
      group.innerHTML = `
        <h2><span class="subject-dot" style="background:${color}"></span>${escapeHtml(subject)}</h2>
        <ul class="item-list"></ul>
      `;
      const ul = group.querySelector('ul');
      for (const a of items) ul.appendChild(renderItem(a));
      checklistGroups.appendChild(group);
    }
  }

  function renderItem(a) {
    const li = document.createElement('li');
    li.className = 'item' + (a.done ? ' done' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = a.done;
    checkbox.setAttribute('aria-label', `Mark "${a.title}" ${a.done ? 'incomplete' : 'complete'}`);
    checkbox.addEventListener('change', () => {
      a.done = checkbox.checked;
      a.updatedAt = Date.now();
      saveAssignments(assignments);
      renderChecklist();
      scheduleSync();
    });

    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'item-body';
    const overdue = isOverdue(a);
    const dateLabel = formatDate(a.date) + (a.time ? ` · ${formatTime(a.time)}` : '');
    body.innerHTML = `
      <div class="item-title">${escapeHtml(a.title)}</div>
      <div class="item-meta${overdue ? ' overdue' : ''}">${overdue ? 'Overdue · ' : ''}${dateLabel}</div>
    `;
    body.addEventListener('click', () => openDialog(a));

    li.appendChild(checkbox);
    li.appendChild(body);
    return li;
  }

  filterSubject.addEventListener('change', renderChecklist);
  hideCompleted.addEventListener('change', renderChecklist);

  /* ---------- calendar view ---------- */

  let calYear, calMonth; // calMonth: 0-11
  let selectedDate = null;

  {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
  }

  const calMonthLabel = document.getElementById('cal-month-label');
  const calWeekdays = document.getElementById('cal-weekdays');
  const calDays = document.getElementById('cal-days');
  const calDayDetail = document.getElementById('cal-day-detail');

  const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  calWeekdays.innerHTML = WEEKDAY_NAMES.map((d) => `<div>${d}</div>`).join('');

  document.getElementById('cal-prev').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });

  function dateKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function renderCalendar() {
    calMonthLabel.textContent = new Date(calYear, calMonth, 1).toLocaleDateString(undefined, {
      month: 'long', year: 'numeric',
    });

    const byDate = new Map();
    for (const a of visibleAssignments()) {
      if (!byDate.has(a.date)) byDate.set(a.date, []);
      byDate.get(a.date).push(a);
    }

    const firstDow = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const today = todayStr();

    calDays.innerHTML = '';
    for (let i = 0; i < firstDow; i++) {
      const cell = document.createElement('div');
      cell.className = 'cal-day empty';
      calDays.appendChild(cell);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const key = dateKey(calYear, calMonth, d);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-day';
      if (key === today) cell.classList.add('today');
      if (key === selectedDate) cell.classList.add('selected');

      const dayItems = byDate.get(key) || [];
      let dotsHtml = '';
      if (dayItems.length) {
        const colors = [...new Set(dayItems.map((a) => subjectColor(a.subject)))].slice(0, 4);
        dotsHtml = `<div class="cal-dots">${colors.map((c) => `<span class="cal-dot" style="background:${c}"></span>`).join('')}</div>`;
      }
      cell.innerHTML = `<span>${d}</span>${dotsHtml}`;
      cell.setAttribute('aria-label', `${key}${dayItems.length ? `, ${dayItems.length} assignment(s)` : ''}`);
      cell.addEventListener('click', () => {
        selectedDate = key;
        renderCalendar();
      });
      calDays.appendChild(cell);
    }

    renderDayDetail(byDate);
  }

  function renderDayDetail(byDate) {
    if (!selectedDate || selectedDate.slice(0, 7) !== `${calYear}-${String(calMonth + 1).padStart(2, '0')}`) {
      calDayDetail.innerHTML = '';
      return;
    }
    const items = (byDate.get(selectedDate) || []).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    if (!items.length) {
      calDayDetail.innerHTML = `<h3>${formatDate(selectedDate)}</h3><p class="empty-state">Nothing due this day.</p>`;
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'item-list';
    for (const a of items) ul.appendChild(renderItem(a));
    calDayDetail.innerHTML = `<h3>${formatDate(selectedDate)}</h3>`;
    calDayDetail.appendChild(ul);
  }

  /* ---------- add / edit dialog ---------- */

  const dialog = document.getElementById('add-dialog');
  const form = document.getElementById('add-form');
  const fId = document.getElementById('f-id');
  const fTitle = document.getElementById('f-title');
  const fSubject = document.getElementById('f-subject');
  const fDate = document.getElementById('f-date');
  const fTime = document.getElementById('f-time');
  const fNotes = document.getElementById('f-notes');
  const btnDelete = document.getElementById('btn-delete');
  const dialogTitle = document.getElementById('add-dialog-title');

  function openDialog(assignment) {
    form.reset();
    if (assignment) {
      dialogTitle.textContent = 'Edit assignment';
      fId.value = assignment.id;
      fTitle.value = assignment.title;
      fSubject.value = assignment.subject;
      fDate.value = assignment.date;
      fTime.value = assignment.time || '';
      fNotes.value = assignment.notes || '';
      btnDelete.hidden = false;
    } else {
      dialogTitle.textContent = 'Add assignment';
      fId.value = '';
      fDate.value = todayStr();
      btnDelete.hidden = true;
    }
    dialog.showModal();
    fTitle.focus();
  }

  document.getElementById('btn-add').addEventListener('click', () => openDialog(null));
  document.getElementById('btn-cancel').addEventListener('click', () => dialog.close());

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!fTitle.value.trim() || !fSubject.value.trim() || !fDate.value) return;

    if (fId.value) {
      const a = assignments.find((x) => x.id === fId.value);
      if (a) {
        a.title = fTitle.value.trim();
        a.subject = fSubject.value.trim();
        a.date = fDate.value;
        a.time = fTime.value || '';
        a.notes = fNotes.value.trim();
        a.updatedAt = Date.now();
      }
    } else {
      assignments.push({
        id: uid(),
        title: fTitle.value.trim(),
        subject: fSubject.value.trim(),
        date: fDate.value,
        time: fTime.value || '',
        notes: fNotes.value.trim(),
        done: false,
        updatedAt: Date.now(),
      });
    }
    saveAssignments(assignments);
    dialog.close();
    renderChecklist();
    renderCalendar();
    scheduleSync();
  });

  btnDelete.addEventListener('click', () => {
    if (!fId.value) return;
    if (!confirm('Delete this assignment?')) return;
    // Soft delete: keep a tombstone so the deletion propagates on sync
    // instead of the item reappearing from another device's copy.
    const a = assignments.find((x) => x.id === fId.value);
    if (a) {
      a.deleted = true;
      a.updatedAt = Date.now();
    }
    saveAssignments(assignments);
    dialog.close();
    renderChecklist();
    renderCalendar();
    scheduleSync();
  });

  dialog.addEventListener('cancel', () => dialog.close());

  /* ---------- .ics export ---------- */

  function pad(n) { return String(n).padStart(2, '0'); }

  function toIcsDate(dateStr) {
    return dateStr.replace(/-/g, '');
  }

  function toIcsDateTime(dateStr, timeStr) {
    const [h, m] = timeStr.split(':');
    return `${toIcsDate(dateStr)}T${pad(h)}${pad(m)}00`;
  }

  function nextDay(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + 1);
    return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
  }

  function foldLine(line) {
    // RFC 5545 line folding at 75 octets
    if (line.length <= 75) return line;
    let out = '';
    let rest = line;
    while (rest.length > 75) {
      out += rest.slice(0, 75) + '\r\n ';
      rest = rest.slice(75);
    }
    return out + rest;
  }

  function escapeIcsText(str) {
    return str.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
  }

  function buildIcs(list) {
    const now = new Date();
    const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ride Along//Paramedic Assignments//EN', 'CALSCALE:GREGORIAN'];

    for (const a of list) {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${a.id}@ride-along.local`);
      lines.push(`DTSTAMP:${stamp}`);
      if (a.time) {
        lines.push(`DTSTART:${toIcsDateTime(a.date, a.time)}`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${toIcsDate(a.date)}`);
        lines.push(`DTEND;VALUE=DATE:${nextDay(a.date)}`);
      }
      lines.push(foldLine(`SUMMARY:${escapeIcsText(`[${a.subject}] ${a.title}`)}`));
      if (a.notes) lines.push(foldLine(`DESCRIPTION:${escapeIcsText(a.notes)}`));
      if (a.done) lines.push('STATUS:CONFIRMED');
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  document.getElementById('btn-export-ics').addEventListener('click', () => {
    const visible = visibleAssignments();
    if (!visible.length) {
      alert('No assignments to export yet.');
      return;
    }
    const ics = buildIcs(visible);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ride-along-assignments-${todayStr()}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  /* ---------- sync (GitHub Gist) ---------- */

  const TOKEN_KEY = 'ride-along-gist-token';
  const GIST_ID_KEY = 'ride-along-gist-id';
  const LAST_SYNCED_KEY = 'ride-along-last-synced';
  const GIST_MARKER = 'ride-along-sync-v1';
  const GIST_FILENAME = 'ride-along-assignments.json';
  const API_BASE = 'https://api.github.com';

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  async function githubFetch(path, token, opts = {}) {
    return fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  }

  async function apiJson(path, token, opts) {
    const res = await githubFetch(path, token, opts);
    if (!res.ok) {
      if (res.status === 401) throw new Error('Invalid or expired token');
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch { /* ignore */ }
      throw new Error(detail || `GitHub API error (${res.status})`);
    }
    return res.status === 204 ? null : res.json();
  }

  async function findOrCreateGist(token) {
    const cachedId = localStorage.getItem(GIST_ID_KEY);
    if (cachedId) {
      const res = await githubFetch(`/gists/${cachedId}`, token);
      if (res.ok) return cachedId;
      if (res.status !== 404) throw new Error(`GitHub API error (${res.status})`);
      localStorage.removeItem(GIST_ID_KEY);
    }

    for (let page = 1; page <= 5; page++) {
      const list = await apiJson(`/gists?per_page=100&page=${page}`, token);
      const found = list.find((g) => g.description && g.description.includes(GIST_MARKER));
      if (found) {
        localStorage.setItem(GIST_ID_KEY, found.id);
        return found.id;
      }
      if (list.length < 100) break;
    }

    const created = await apiJson('/gists', token, {
      method: 'POST',
      body: JSON.stringify({
        description: `Ride Along sync data (${GIST_MARKER}) — do not delete`,
        public: false,
        files: { [GIST_FILENAME]: { content: JSON.stringify({ assignments: [] }) } },
      }),
    });
    localStorage.setItem(GIST_ID_KEY, created.id);
    return created.id;
  }

  async function pullRemote(token, gistId) {
    const gist = await apiJson(`/gists/${gistId}`, token);
    const file = gist.files && gist.files[GIST_FILENAME];
    if (!file) return [];
    let content = file.content || '';
    if (file.truncated && file.raw_url) {
      content = await (await fetch(file.raw_url)).text();
    }
    try {
      const parsed = JSON.parse(content || '{}');
      return Array.isArray(parsed.assignments) ? parsed.assignments : [];
    } catch {
      return [];
    }
  }

  async function pushRemote(token, gistId, list) {
    await apiJson(`/gists/${gistId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ files: { [GIST_FILENAME]: { content: JSON.stringify({ assignments: list }) } } }),
    });
  }

  function pruneTombstones(list) {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    return list.filter((a) => !a.deleted || (a.updatedAt || 0) > cutoff);
  }

  function mergeAssignments(localList, remoteList) {
    const byId = new Map();
    for (const a of remoteList) byId.set(a.id, a);
    for (const a of localList) {
      const existing = byId.get(a.id);
      if (!existing || (a.updatedAt || 0) >= (existing.updatedAt || 0)) byId.set(a.id, a);
    }
    return pruneTombstones([...byId.values()]);
  }

  function stableKey(list) {
    return JSON.stringify([...list].sort((a, b) => a.id.localeCompare(b.id)));
  }

  let syncing = false;
  let lastSyncError = null;
  let syncDebounceTimer = null;

  function scheduleSync() {
    if (!getToken()) return;
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => syncNow(), 700);
  }

  async function syncNow() {
    const token = getToken();
    if (!token || syncing) return;

    if (!navigator.onLine) {
      lastSyncError = 'Offline — will sync when back online';
      renderSyncStatusText();
      return;
    }

    syncing = true;
    lastSyncError = null;
    setSyncButtonBusy(true);
    try {
      const gistId = await findOrCreateGist(token);
      const remote = await pullRemote(token, gistId);
      const merged = mergeAssignments(assignments, remote);

      if (stableKey(merged) !== stableKey(assignments)) {
        assignments = merged;
        saveAssignments(assignments);
        renderChecklist();
        renderCalendar();
      }
      if (stableKey(merged) !== stableKey(remote)) {
        await pushRemote(token, gistId, merged);
      }
      localStorage.setItem(LAST_SYNCED_KEY, String(Date.now()));
    } catch (err) {
      lastSyncError = err.message || 'Sync failed';
    } finally {
      syncing = false;
      setSyncButtonBusy(false);
      renderSyncStatusText();
    }
  }

  function relativeTime(ms) {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins === 1) return '1 minute ago';
    if (mins < 60) return `${mins} minutes ago`;
    const hrs = Math.round(mins / 60);
    if (hrs === 1) return '1 hour ago';
    if (hrs < 24) return `${hrs} hours ago`;
    const days = Math.round(hrs / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
  }

  function setSyncButtonBusy(busy) {
    const btn = document.getElementById('btn-sync');
    btn.disabled = busy;
    btn.textContent = busy ? 'Syncing…' : 'Sync';
  }

  const syncDialog = document.getElementById('sync-dialog');
  const syncForm = document.getElementById('sync-form');
  const fToken = document.getElementById('f-token');
  const syncStatusEl = document.getElementById('sync-status');
  const btnSyncDisconnect = document.getElementById('btn-sync-disconnect');

  function renderSyncStatusText() {
    const token = getToken();
    if (!token) {
      syncStatusEl.textContent = 'Not connected on this device yet.';
      return;
    }
    if (lastSyncError) {
      syncStatusEl.textContent = `Sync error: ${lastSyncError}`;
      return;
    }
    const last = localStorage.getItem(LAST_SYNCED_KEY);
    syncStatusEl.textContent = last ? `Last synced ${relativeTime(Number(last))}` : 'Connected — syncing…';
  }

  function openSyncDialog() {
    fToken.value = getToken();
    btnSyncDisconnect.hidden = !getToken();
    renderSyncStatusText();
    syncDialog.showModal();
  }

  document.getElementById('btn-sync').addEventListener('click', () => {
    if (getToken()) syncNow();
    else openSyncDialog();
  });
  document.getElementById('btn-sync-settings').addEventListener('click', openSyncDialog);
  document.getElementById('btn-sync-cancel').addEventListener('click', () => syncDialog.close());
  syncDialog.addEventListener('cancel', () => syncDialog.close());

  syncForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const token = fToken.value.trim();
    if (!token) return;
    setToken(token);
    syncDialog.close();
    syncNow();
  });

  btnSyncDisconnect.addEventListener('click', () => {
    if (!confirm('Disconnect sync on this device? Your assignments stay saved locally.')) return;
    clearToken();
    localStorage.removeItem(GIST_ID_KEY);
    localStorage.removeItem(LAST_SYNCED_KEY);
    lastSyncError = null;
    syncDialog.close();
  });

  /* ---------- offline banner ---------- */

  const offlineBanner = document.getElementById('offline-banner');
  function updateOnlineStatus() {
    offlineBanner.hidden = navigator.onLine;
  }
  window.addEventListener('online', () => { updateOnlineStatus(); syncNow(); });
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  /* ---------- service worker ---------- */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });

    // When a newer service worker takes over (a fresh deploy), reload once
    // so an already-open tab/installed window shows it instead of stale assets.
    let reloadedForUpdate = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadedForUpdate) return;
      reloadedForUpdate = true;
      window.location.reload();
    });
  }

  /* ---------- init ---------- */

  renderChecklist();
  syncNow();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  window.addEventListener('focus', () => syncNow());
})();
