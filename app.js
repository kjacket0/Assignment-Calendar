(() => {
  'use strict';

  const STORAGE_KEY = 'feldkamp-assignments-v1';
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

  /* ---------- app-styled prompt/confirm/alert ----------
   * Browsers stamp native prompt()/confirm()/alert() dialogs with "<origin>
   * says" and there's no way to remove or relabel that — it's a deliberate
   * anti-spoofing feature, not an oversight. These are drop-in async
   * replacements using the app's own <dialog> styling instead, so nothing
   * ever shows a raw github.io URL to the user.
   */
  const promptDialog = document.getElementById('prompt-dialog');
  const promptForm = document.getElementById('prompt-form');
  const promptMessageEl = document.getElementById('prompt-message');
  const promptField = document.getElementById('prompt-field');
  const promptInput = document.getElementById('prompt-input');
  const promptCancelBtn = document.getElementById('prompt-cancel');

  function appDialog({ message, defaultValue = '', showInput, showCancel }) {
    return new Promise((resolve) => {
      promptMessageEl.textContent = message;
      promptField.hidden = !showInput;
      promptCancelBtn.hidden = !showCancel;
      if (showInput) promptInput.value = defaultValue;

      function cleanup() {
        promptForm.removeEventListener('submit', onSubmit);
        promptCancelBtn.removeEventListener('click', onCancel);
        promptDialog.removeEventListener('cancel', onCancel);
      }
      function onSubmit(e) {
        e.preventDefault();
        cleanup();
        promptDialog.close();
        resolve(showInput ? promptInput.value.trim() : true);
      }
      function onCancel() {
        cleanup();
        promptDialog.close();
        resolve(showInput ? null : false);
      }
      promptForm.addEventListener('submit', onSubmit);
      promptCancelBtn.addEventListener('click', onCancel);
      promptDialog.addEventListener('cancel', onCancel);
      promptDialog.showModal();
      (showInput ? promptInput : document.getElementById('prompt-ok')).focus();
    });
  }

  function appPrompt(message, defaultValue) {
    return appDialog({ message, defaultValue: defaultValue || '', showInput: true, showCancel: true });
  }
  function appConfirm(message) {
    return appDialog({ message, showInput: false, showCancel: true });
  }
  function appAlert(message) {
    return appDialog({ message, showInput: false, showCancel: false });
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
      // Adding while browsing the calendar with a day selected should
      // default to that day, not silently fall back to today.
      fDate.value = (!viewCalendar.hidden && selectedDate) ? selectedDate : todayStr();
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

  btnDelete.addEventListener('click', async () => {
    if (!fId.value) return;
    if (!(await appConfirm('Delete this assignment?'))) return;
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

    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FELDKAMP//Paramedic Assignments//EN', 'CALSCALE:GREGORIAN'];

    for (const a of list) {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${a.id}@feldkamp.local`);
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

  document.getElementById('btn-export-ics').addEventListener('click', async () => {
    const visible = visibleAssignments();
    if (!visible.length) {
      await appAlert('No assignments to export yet.');
      return;
    }
    const ics = buildIcs(visible);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `feldkamp-assignments-${todayStr()}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  /* ---------- theming ---------- */

  const THEME_KEY = 'feldkamp-theme';
  const THEMES = [
    { id: 'ihcc', label: 'IHCC Green', light: '#1b7e23', dark: '#34b23e' },
    { id: 'plum', label: 'Plum', light: '#7c1fa0', dark: '#bb5de0' },
    { id: 'blue', label: 'Blue', light: '#1c4d9c', dark: '#5a8ee2' },
    { id: 'teal', label: 'Teal', light: '#127d79', dark: '#5ae2dd' },
    { id: 'crimson', label: 'Crimson', light: '#9c1c31', dark: '#e25a71' },
    { id: 'emerald', label: 'Emerald', light: '#127d44', dark: '#5ae29a' },
    { id: 'amber', label: 'Amber', light: '#9c641c', dark: '#e2a75a' },
  ];

  function getStoredTheme() { return localStorage.getItem(THEME_KEY) || 'ihcc'; }

  function applyTheme(id) {
    document.documentElement.setAttribute('data-theme', id);
    localStorage.setItem(THEME_KEY, id);
    renderThemeSwatches();
  }

  const themeSwatchesEl = document.getElementById('theme-swatches');

  function renderThemeSwatches() {
    const current = getStoredTheme();
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    themeSwatchesEl.innerHTML = '';
    for (const t of THEMES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-swatch';
      btn.style.setProperty('--swatch', prefersDark ? t.dark : t.light);
      btn.setAttribute('aria-label', t.label);
      btn.setAttribute('aria-pressed', String(t.id === current));
      btn.title = t.label;
      btn.addEventListener('click', () => applyTheme(t.id));
      themeSwatchesEl.appendChild(btn);
    }
  }

  renderThemeSwatches();

  /* ---------- sync (Firebase Firestore) ---------- */

  // Filled in once the Firebase project exists — see README for setup.
  // The API key is not a secret (Firebase's own docs say it's safe to
  // ship client-side); access is governed by Firestore security rules,
  // which restrict every document to exact-path get/create/update only
  // (no listing, no deleting) — so a sync code functions like an
  // unguessable capability key rather than a password.
  const FIREBASE_PROJECT_ID = 'feldkamp-pwa';
  const FIREBASE_API_KEY = 'AIzaSyAUdoVZbcsA7cosnvPHAyls33fQrkRqKKk';
  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

  const SYNC_ENABLED_KEY = 'feldkamp-sync-enabled';
  const LISTS_KEY = 'feldkamp-lists';
  const ACTIVE_CODE_KEY = 'feldkamp-active-code';
  const LAST_SYNCED_KEY = 'feldkamp-last-synced';

  function isSyncEnabled() { return localStorage.getItem(SYNC_ENABLED_KEY) === '1'; }

  // Plain-English words instead of a hex blob: "tiger-plasma-orbit-glacier"
  // reads out loud, types on a phone keyboard, and survives a typo better
  // than a wall of hex ever would. 256 words × 4 gives 2^32 combinations —
  // plenty against guessing, especially paired with Firestore rules that
  // block listing the collection outright.
  const CODE_WORDS = [
    'anchor', 'antler', 'apple', 'arrow', 'aspen', 'atlas', 'badge', 'badger', 'banjo', 'barrel',
    'basil', 'basket', 'beacon', 'beaver', 'birch', 'bishop', 'blanket', 'boulder', 'breeze', 'bronze',
    'bucket', 'buckle', 'bugle', 'button', 'cactus', 'camel', 'candle', 'canoe', 'canyon', 'cargo',
    'cedar', 'cellar', 'chalk', 'charm', 'cherry', 'chisel', 'cider', 'cinder', 'clover', 'cobra',
    'comet', 'compass', 'condor', 'copper', 'coral', 'cotton', 'cougar', 'crane', 'crater', 'cricket',
    'crimson', 'cyclone', 'dagger', 'daisy', 'delta', 'desert', 'dingo', 'dolphin', 'dragon', 'drift',
    'eagle', 'ember', 'emerald', 'engine', 'falcon', 'feather', 'fennel', 'ferret', 'fiddle', 'finch',
    'fjord', 'flame', 'flannel', 'flint', 'forest', 'fossil', 'fountain', 'fox', 'galaxy', 'garnet',
    'gazelle', 'gecko', 'geyser', 'ginger', 'glacier', 'goblet', 'goose', 'granite', 'gravel', 'guitar',
    'gully', 'hamlet', 'hammer', 'harbor', 'harvest', 'hazel', 'heron', 'hickory', 'hollow', 'horizon',
    'hornet', 'hunter', 'husky', 'ibis', 'iguana', 'indigo', 'island', 'ivory', 'jacket', 'jaguar',
    'jasper', 'jelly', 'jester', 'jungle', 'kayak', 'kernel', 'kettle', 'kingfisher', 'kiosk', 'koala',
    'ladder', 'lagoon', 'lantern', 'lark', 'lava', 'lavender', 'ledge', 'lemur', 'lentil', 'lichen',
    'lilac', 'lizard', 'llama', 'lobster', 'locket', 'lotus', 'lynx', 'magnet', 'mallet', 'mammoth',
    'mango', 'mantis', 'maple', 'marble', 'marlin', 'marsh', 'meadow', 'melon', 'mesa', 'meteor',
    'mineral', 'minnow', 'mirror', 'moccasin', 'monsoon', 'moose', 'moraine', 'moss', 'mustang', 'napkin',
    'nautical', 'nebula', 'needle', 'nettle', 'nickel', 'nimbus', 'noodle', 'nutmeg', 'oasis', 'ocelot',
    'onyx', 'opal', 'orbit', 'orchard', 'orchid', 'osprey', 'otter', 'outpost', 'owl', 'oyster',
    'paddle', 'panda', 'pantry', 'panther', 'papaya', 'parcel', 'parrot', 'pebble', 'pelican', 'penny',
    'pepper', 'petal', 'pheasant', 'pickle', 'pigeon', 'pillow', 'pine', 'pioneer', 'piston', 'plasma',
    'plateau', 'plum', 'pocket', 'poplar', 'poppy', 'possum', 'prairie', 'prism', 'puddle', 'pumpkin',
    'quail', 'quartz', 'quilt', 'rabbit', 'raccoon', 'radish', 'raven', 'reef', 'ribbon', 'ridge',
    'river', 'rocket', 'rooster', 'ruby', 'saddle', 'saffron', 'sage', 'salmon', 'satchel', 'sapphire',
    'savanna', 'scarlet', 'scout', 'sequoia', 'shadow', 'shovel', 'shrimp', 'sierra', 'silo', 'skiff',
    'sloth', 'sparrow', 'spatula', 'sphinx', 'spiral', 'spring', 'spruce', 'squid', 'stable', 'stallion',
    'starling', 'summit', 'sunset', 'swallow', 'swan', 'tanager', 'tangerine', 'tapestry', 'thimble', 'thistle',
    'thunder', 'thyme', 'tide', 'tiger', 'timber', 'toast', 'toucan', 'trellis', 'trout', 'tulip',
    'tundra', 'tunnel', 'turtle', 'tusk', 'twilight', 'umber', 'valley', 'velvet', 'vessel', 'violet',
    'vulture', 'wagon', 'walnut', 'walrus', 'warbler', 'weasel', 'whale', 'wheat', 'whistle', 'wicker',
    'willow', 'wolf', 'wombat', 'zebra', 'zephyr', 'zinnia',
  ];

  function randomInt(max) {
    if (window.crypto && crypto.getRandomValues) {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return arr[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function genCode() {
    const words = [];
    for (let i = 0; i < 4; i++) words.push(CODE_WORDS[randomInt(CODE_WORDS.length)]);
    return words.join('-');
  }

  function normalizeCode(raw) {
    return raw
      .trim()
      .toLowerCase()
      .replace(/\s*-\s*/g, '-') // collapse "word - word" (typed hyphen plus stray spaces) to "word-word"
      .replace(/\s+/g, '-');    // any remaining run of spaces (hyphen dropped entirely) becomes one
  }

  function getLists() {
    try { return JSON.parse(localStorage.getItem(LISTS_KEY) || '[]'); } catch { return []; }
  }
  function saveLists(lists) { localStorage.setItem(LISTS_KEY, JSON.stringify(lists)); }
  function getActiveCode() { return localStorage.getItem(ACTIVE_CODE_KEY) || ''; }
  function setActiveCode(code) { localStorage.setItem(ACTIVE_CODE_KEY, code); }

  // Ensures this device has at least one list and an active code, minting
  // a fresh one on first use. Purely local — no network round-trip needed,
  // since codes are self-issued rather than discovered from an account.
  function ensureActiveCode() {
    let lists = getLists();
    if (lists.length === 0) {
      const code = genCode();
      lists = [{ code, name: 'My Assignments' }];
      saveLists(lists);
      setActiveCode(code);
    }
    let active = getActiveCode();
    if (!active || !lists.some((l) => l.code === active)) {
      active = lists[0].code;
      setActiveCode(active);
    }
    return active;
  }

  async function firestoreFetch(path, opts = {}) {
    const sep = path.includes('?') ? '&' : '?';
    return fetch(`${FIRESTORE_BASE}${path}${sep}key=${FIREBASE_API_KEY}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
  }

  async function firestoreErrorMessage(res) {
    try {
      const body = await res.json();
      return (body.error && body.error.message) || `Sync backend error (${res.status})`;
    } catch {
      return `Sync backend error (${res.status})`;
    }
  }

  async function pullRemote(code) {
    const res = await firestoreFetch(`/syncCodes/${code}`);
    if (res.status === 404) return { name: '', assignments: [] };
    if (!res.ok) throw new Error(await firestoreErrorMessage(res));
    const doc = await res.json();
    const raw = doc.fields && doc.fields.data && doc.fields.data.stringValue;
    try {
      const parsed = JSON.parse(raw || '{}');
      return { name: parsed.name || '', assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [] };
    } catch {
      return { name: '', assignments: [] };
    }
  }

  async function pushRemote(code, name, list) {
    const res = await firestoreFetch(`/syncCodes/${code}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { data: { stringValue: JSON.stringify({ name, assignments: list }) } } }),
    });
    if (!res.ok) throw new Error(await firestoreErrorMessage(res));
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
    if (!isSyncEnabled()) return;
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => syncNow(), 700);
  }

  async function syncNow() {
    if (!isSyncEnabled() || syncing) return;

    if (!navigator.onLine) {
      lastSyncError = 'Offline — will sync when back online';
      renderSyncStatusText();
      return;
    }

    const code = ensureActiveCode();
    syncing = true;
    lastSyncError = null;
    setSyncButtonBusy(true);
    try {
      const remote = await pullRemote(code);
      const merged = mergeAssignments(assignments, remote.assignments);

      if (stableKey(merged) !== stableKey(assignments)) {
        assignments = merged;
        saveAssignments(assignments);
        renderChecklist();
        renderCalendar();
      }

      const lists = getLists();
      let entry = lists.find((l) => l.code === code);
      if (!entry) {
        entry = { code, name: remote.name || 'My Assignments' };
        lists.push(entry);
        saveLists(lists);
      } else if (!entry.name && remote.name) {
        entry.name = remote.name;
        saveLists(lists);
      }

      if (stableKey(merged) !== stableKey(remote.assignments) || entry.name !== remote.name) {
        await pushRemote(code, entry.name, merged);
      }
      localStorage.setItem(LAST_SYNCED_KEY, String(Date.now()));
    } catch (err) {
      lastSyncError = err.message || 'Sync failed';
    } finally {
      syncing = false;
      setSyncButtonBusy(false);
      renderSyncStatusText();
      renderListControls();
    }
  }

  // Pushes any pending local edits to the currently active list, then
  // switches the working set over to a different list. Nothing local is
  // lost in the handoff — the old list is flushed before switching away.
  async function switchActiveCode(newCode) {
    if (syncing || newCode === getActiveCode()) return;
    syncing = true;
    lastSyncError = null;
    setSyncButtonBusy(true);
    try {
      const currentCode = getActiveCode();
      if (currentCode) {
        const remoteCurrent = await pullRemote(currentCode);
        const mergedCurrent = mergeAssignments(assignments, remoteCurrent.assignments);
        const currentEntry = getLists().find((l) => l.code === currentCode);
        if (stableKey(mergedCurrent) !== stableKey(remoteCurrent.assignments)) {
          await pushRemote(currentCode, currentEntry ? currentEntry.name : '', mergedCurrent);
        }
      }
      const remoteNew = await pullRemote(newCode);
      assignments = pruneTombstones(remoteNew.assignments);
      saveAssignments(assignments);
      setActiveCode(newCode);
      localStorage.setItem(LAST_SYNCED_KEY, String(Date.now()));
      renderChecklist();
      renderCalendar();
    } catch (err) {
      lastSyncError = err.message || 'Failed to switch lists';
    } finally {
      syncing = false;
      setSyncButtonBusy(false);
      renderSyncStatusText();
      renderListControls();
    }
  }

  async function createNewList() {
    const name = ((await appPrompt('Name this list (e.g. "Fall Semester"):')) || '').trim();
    if (!name) return;
    const code = genCode();
    const lists = getLists();
    lists.push({ code, name });
    saveLists(lists);
    await switchActiveCode(code);
  }

  async function renameActiveList() {
    const code = getActiveCode();
    if (!code) return;
    const lists = getLists();
    const current = lists.find((l) => l.code === code);
    const name = ((await appPrompt('Rename this list:', current ? current.name : '')) || '').trim();
    if (!name || (current && name === current.name)) return;
    if (current) current.name = name;
    else lists.push({ code, name });
    saveLists(lists);
    renderListControls();
    scheduleSync();
  }

  async function forgetActiveList() {
    const code = getActiveCode();
    const lists = getLists();
    if (lists.length <= 1) {
      await appAlert('This is the only list on this device — create another list first if you want to remove this one.');
      return;
    }
    if (!(await appConfirm("Remove this list from this device? It stays intact in the cloud — this device just stops tracking it. You can relink it later by entering its code again."))) return;
    const remaining = lists.filter((l) => l.code !== code);
    saveLists(remaining);
    switchActiveCode(remaining[0].code);
  }

  async function joinCode() {
    const input = document.getElementById('f-join-code');
    const code = normalizeCode(input.value);
    if (!code) return;
    const lists = getLists();
    if (lists.some((l) => l.code === code)) {
      await switchActiveCode(code);
      input.value = '';
      return;
    }
    setSyncButtonBusy(true);
    try {
      const remote = await pullRemote(code);
      lists.push({ code, name: remote.name || 'Linked list' });
      saveLists(lists);
      await switchActiveCode(code);
      input.value = '';
    } catch (err) {
      lastSyncError = err.message || 'Failed to link that code';
      renderSyncStatusText();
    } finally {
      setSyncButtonBusy(false);
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
  const syncStatusEl = document.getElementById('sync-status');
  const syncOffControls = document.getElementById('sync-off-controls');
  const syncOnControls = document.getElementById('sync-on-controls');
  const activeCodeDisplay = document.getElementById('active-code-display');
  const listSelectEl = document.getElementById('list-select');
  const fJoinCode = document.getElementById('f-join-code');

  function renderSyncStatusText() {
    if (!isSyncEnabled()) {
      syncStatusEl.textContent = '';
      return;
    }
    if (lastSyncError) {
      syncStatusEl.textContent = `Sync error: ${lastSyncError}`;
      return;
    }
    const last = localStorage.getItem(LAST_SYNCED_KEY);
    syncStatusEl.textContent = last ? `Last synced ${relativeTime(Number(last))}` : 'Connected — syncing…';
  }

  function renderListControls() {
    const lists = getLists();
    const active = getActiveCode();
    activeCodeDisplay.textContent = active;
    listSelectEl.innerHTML = lists
      .map((l) => `<option value="${escapeHtml(l.code)}"${l.code === active ? ' selected' : ''}>${escapeHtml(l.name)}</option>`)
      .join('');
  }

  function renderSyncSections() {
    const enabled = isSyncEnabled();
    syncOffControls.hidden = enabled;
    syncOnControls.hidden = !enabled;
    if (!enabled) return;
    ensureActiveCode();
    renderListControls();
    renderSyncStatusText();
  }

  function openSyncDialog() {
    renderSyncSections();
    syncDialog.showModal();
  }

  document.getElementById('btn-sync').addEventListener('click', async () => {
    if (!isSyncEnabled()) localStorage.setItem(SYNC_ENABLED_KEY, '1');
    await syncNow();
  });
  document.getElementById('btn-sync-settings').addEventListener('click', openSyncDialog);
  document.getElementById('btn-sync-cancel').addEventListener('click', () => syncDialog.close());
  syncDialog.addEventListener('cancel', () => syncDialog.close());

  document.getElementById('btn-sync-enable').addEventListener('click', async () => {
    localStorage.setItem(SYNC_ENABLED_KEY, '1');
    renderSyncSections();
    await syncNow();
    renderSyncSections();
  });

  document.getElementById('btn-copy-code').addEventListener('click', async () => {
    const btn = document.getElementById('btn-copy-code');
    try {
      await navigator.clipboard.writeText(getActiveCode());
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = original; }, 1500);
    } catch {
      await appAlert('Could not copy automatically — select and copy the code manually.');
    }
  });

  listSelectEl.addEventListener('change', () => switchActiveCode(listSelectEl.value));
  document.getElementById('btn-list-new').addEventListener('click', createNewList);
  document.getElementById('btn-list-rename').addEventListener('click', renameActiveList);
  document.getElementById('btn-list-forget').addEventListener('click', forgetActiveList);
  document.getElementById('btn-join-code').addEventListener('click', joinCode);
  fJoinCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); joinCode(); }
  });

  document.getElementById('btn-sync-disconnect').addEventListener('click', async () => {
    if (!(await appConfirm("Turn off sync on this device? Your assignments stay saved locally — the cloud copy is untouched."))) return;
    localStorage.removeItem(SYNC_ENABLED_KEY);
    lastSyncError = null;
    renderSyncSections();
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

    // controllerchange also fires on a brand-new visit's very first
    // activation (there's nothing to "update" from there) — only treat it
    // as a real update if a service worker was already controlling this
    // page beforehand, i.e. a fresh deploy took over an existing session.
    const hadControllerAlready = !!navigator.serviceWorker.controller;
    let shownUpdate = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (shownUpdate || !hadControllerAlready) return;
      shownUpdate = true;
      document.getElementById('btn-update').hidden = false;
    });
  }

  document.getElementById('btn-update').addEventListener('click', () => window.location.reload());

  /* ---------- init ---------- */

  renderChecklist();
  syncNow();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  window.addEventListener('focus', () => syncNow());
})();
