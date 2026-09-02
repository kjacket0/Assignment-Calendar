(() => {
  'use strict';

  const STORAGE_KEY = 'feldkamp-assignments-v1';
  const SUBJECT_PALETTE = [
    '#0f6266', '#a35d00', '#5b3fb6', '#b3261e',
    '#2e7d32', '#8e4585', '#00695c', '#6d4c00',
  ];

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed;
    } catch {
      return fallback;
    }
  }

  /* ---------- storage ---------- */

  function loadAssignments() {
    const list = readJson(STORAGE_KEY, []);
    if (!Array.isArray(list)) return [];
    // Backfill updatedAt for data saved before sync existed.
    return list.map((a) => (a && a.updatedAt ? a : { ...a, updatedAt: Date.now() }));
  }

  function saveAssignments(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function visibleAssignments() {
    return assignments.filter((a) => !a.deleted);
  }

  let assignments = loadAssignments();

  /* ---------- subjects ----------
   * Subjects are their own persisted entities (name + color), separate
   * from assignments, so a class list can be set up before anything is
   * assigned yet, keeps its chosen color, and doesn't disappear from the
   * checklist just because everything under it is done or deleted.
   */

  const SUBJECTS_KEY = 'feldkamp-subjects-v1';

  function loadSubjects() {
    const list = readJson(SUBJECTS_KEY, []);
    if (!Array.isArray(list)) return [];
    return list.map((s) => (s && s.updatedAt ? s : { ...s, updatedAt: Date.now() }));
  }

  function saveSubjects(list) {
    localStorage.setItem(SUBJECTS_KEY, JSON.stringify(list));
  }

  function visibleSubjects() {
    return subjects.filter((s) => !s.deleted);
  }

  let subjects = loadSubjects();

  // Backfill: subjects didn't used to be their own persisted records, so
  // data from before this existed (e.g. an assignment already filed under
  // "Pathophysiology") needs a record created for it here once — otherwise
  // the checklist shows the subject (it also derives names from
  // assignments) while the Settings management list looks empty.
  (function backfillSubjectsFromAssignments() {
    let changed = false;
    for (const a of visibleAssignments()) {
      if (!a.subject || subjects.some((s) => s.name === a.subject && !s.deleted)) continue;
      subjects.push({ id: uid(), name: a.subject, color: hashColor(a.subject), updatedAt: Date.now() });
      changed = true;
    }
    if (changed) saveSubjects(subjects);
  })();

  /* ---------- helpers ---------- */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function hashColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return SUBJECT_PALETTE[hash % SUBJECT_PALETTE.length];
  }

  function subjectColor(name) {
    const existing = visibleSubjects().find((s) => s.name === name);
    return existing ? existing.color : hashColor(name);
  }

  // Auto-creates a persisted subject record the first time an assignment
  // references a subject name with none yet, so typing a brand-new subject
  // straight into the assignment form still works without a trip through
  // Settings first — it just gets an auto-picked color instead of a chosen one.
  function ensureSubject(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (subjects.some((s) => s.name === trimmed && !s.deleted)) return;
    const revived = subjects.find((s) => s.name === trimmed && s.deleted);
    if (revived) {
      revived.deleted = false;
      revived.updatedAt = Date.now();
    } else {
      subjects.push({ id: uid(), name: trimmed, color: hashColor(trimmed), updatedAt: Date.now() });
    }
    saveSubjects(subjects);
  }

  // The union of subjects that exist on purpose (added ahead of time or via
  // an assignment) — sorted for consistent display in dropdowns and groups.
  function allSubjectNames() {
    const names = new Set(visibleSubjects().map((s) => s.name));
    for (const a of visibleAssignments()) names.add(a.subject);
    return [...names].sort((a, b) => a.localeCompare(b));
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

  /* ---------- tabs ---------- */

  const TABS = {
    checklist: { btn: document.getElementById('tab-checklist'), view: document.getElementById('view-checklist') },
    upcoming: { btn: document.getElementById('tab-upcoming'), view: document.getElementById('view-upcoming') },
    calendar: { btn: document.getElementById('tab-calendar'), view: document.getElementById('view-calendar') },
  };

  function showTab(name) {
    for (const key of Object.keys(TABS)) {
      const active = key === name;
      TABS[key].btn.setAttribute('aria-selected', String(active));
      TABS[key].view.hidden = !active;
    }
    if (name === 'calendar') renderCalendar();
    else if (name === 'upcoming') renderUpcoming();
  }

  for (const key of Object.keys(TABS)) {
    TABS[key].btn.addEventListener('click', () => showTab(key));
  }

  /* ---------- checklist view ---------- */

  const hideCompleted = document.getElementById('hide-completed');
  const checklistGroups = document.getElementById('checklist-groups');
  const checklistEmpty = document.getElementById('checklist-empty');

  // Subject names the user has manually collapsed in the checklist —
  // survives re-renders (data edits, sync) since it lives outside
  // renderChecklist() itself; not persisted across reloads on purpose,
  // same "always starts predictable" reasoning as the rest of the app.
  const collapsedSubjects = new Set();

  function refreshSubjectOptions() {
    const names = allSubjectNames();
    const datalist = document.getElementById('subject-list');
    datalist.innerHTML = names.map((s) => `<option value="${escapeHtml(s)}">`).join('');
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
    const hideDone = hideCompleted.checked;

    const visible = visibleAssignments();
    checklistGroups.innerHTML = '';

    if (visible.length === 0 && visibleSubjects().length === 0) {
      checklistEmpty.hidden = false;
      checklistEmpty.textContent = 'No assignments yet. Tap "+ Add" to get started.';
      return;
    }

    checklistEmpty.hidden = true;

    // A subject group is shown for every subject that exists on purpose —
    // even with zero (or zero currently-visible) items — so a class list
    // set up ahead of time, or one that's simply all caught up, sticks
    // around instead of vanishing. Each one collapses independently
    // instead of a dropdown narrowing the whole list to one at a time.
    const names = allSubjectNames();
    names.forEach((subject, idx) => {
      let items = visible.filter((a) => a.subject === subject);
      const hadAny = items.length > 0;
      if (hideDone) items = items.filter((a) => !a.done);
      items.sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
      });

      const group = document.createElement('div');
      group.className = 'subject-group';
      const color = subjectColor(subject);
      const countHtml = items.length
        ? `<span class="subject-count">${items.length} assignment${items.length === 1 ? '' : 's'}</span>`
        : '';
      const collapsed = collapsedSubjects.has(subject);
      const bodyId = `subject-body-${idx}`;
      group.innerHTML = `
        <button type="button" class="subject-group-header" aria-expanded="${!collapsed}" aria-controls="${bodyId}">
          <span class="subject-dot" style="background:${color}"></span>
          <span class="subject-name">${escapeHtml(subject)}</span>
          ${countHtml}
          <span class="subject-chevron" aria-hidden="true">▾</span>
        </button>
        <ul class="item-list" id="${bodyId}"${collapsed ? ' hidden' : ''}></ul>
      `;
      const header = group.querySelector('.subject-group-header');
      const ul = group.querySelector('ul');
      header.addEventListener('click', () => {
        if (collapsedSubjects.has(subject)) collapsedSubjects.delete(subject);
        else collapsedSubjects.add(subject);
        renderChecklist();
      });
      if (items.length) {
        for (const a of items) ul.appendChild(renderItem(a));
      } else {
        const li = document.createElement('li');
        li.className = 'subject-empty';
        li.textContent = hadAny ? 'All caught up — nothing pending.' : 'No assignments yet.';
        ul.appendChild(li);
      }
      checklistGroups.appendChild(group);
    });
  }

  function renderItem(a, opts = {}) {
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
      renderUpcoming();
      scheduleSync();
    });

    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'item-body';
    const overdue = isOverdue(a);
    const dateLabel = formatDate(a.date) + (a.time ? ` · ${formatTime(a.time)}` : '');
    // Subject + notes only make sense outside the checklist, where items
    // are already grouped under a subject heading and opening the edit
    // dialog is one tap away — the calendar's day view has neither.
    const subjectHtml = opts.showSubject
      ? `<div class="item-subject"><span class="subject-dot" style="background:${subjectColor(a.subject)}"></span>${escapeHtml(a.subject)}</div>`
      : '';
    const notesHtml = opts.showNotes && a.notes
      ? `<div class="item-notes">${escapeHtml(a.notes)}</div>`
      : '';
    body.innerHTML = `
      ${subjectHtml}
      <div class="item-title">${escapeHtml(a.title)}</div>
      <div class="item-meta${overdue ? ' overdue' : ''}">${overdue ? 'Overdue · ' : ''}${dateLabel}</div>
      ${notesHtml}
    `;
    body.addEventListener('click', () => openDialog(a));

    li.appendChild(checkbox);
    li.appendChild(body);
    return li;
  }

  hideCompleted.addEventListener('change', renderChecklist);

  /* ---------- upcoming view ----------
   * A second, time-ordered cut of the same data the checklist groups by
   * subject — inspired by Brightspace Pulse's schedule view: what's due
   * today, this week, and later, across every subject at a glance. Done
   * items just drop out entirely rather than showing crossed-out, since
   * "due" stops meaning anything once it's done.
   */

  const upcomingGroups = document.getElementById('upcoming-groups');
  const upcomingEmpty = document.getElementById('upcoming-empty');

  function renderUpcoming() {
    const today = todayStr();
    const weekEnd = shiftDateKey(today, 6 - new Date().getDay());

    const buckets = { overdue: [], today: [], week: [], later: [] };
    for (const a of visibleAssignments()) {
      if (a.done) continue;
      if (a.date < today) buckets.overdue.push(a);
      else if (a.date === today) buckets.today.push(a);
      else if (a.date <= weekEnd) buckets.week.push(a);
      else buckets.later.push(a);
    }

    const sections = [
      { key: 'overdue', label: 'Overdue', overdue: true },
      { key: 'today', label: 'Today' },
      { key: 'week', label: 'This Week' },
      { key: 'later', label: 'Later' },
    ];

    upcomingGroups.innerHTML = '';
    let renderedAny = false;
    for (const { key, label, overdue } of sections) {
      const items = buckets[key];
      if (!items.length) continue;
      renderedAny = true;
      items.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));

      const group = document.createElement('div');
      group.className = 'subject-group' + (overdue ? ' upcoming-overdue' : '');
      group.innerHTML = `
        <h2>
          <span>${label}</span>
          <span class="subject-count">${items.length} assignment${items.length === 1 ? '' : 's'}</span>
        </h2>
        <ul class="item-list"></ul>
      `;
      const ul = group.querySelector('ul');
      for (const a of items) ul.appendChild(renderItem(a, { showSubject: true }));
      upcomingGroups.appendChild(group);
    }
    upcomingEmpty.hidden = renderedAny;
  }

  /* ---------- calendar view ---------- */

  let calYear, calMonth; // calMonth: 0-11
  let selectedDate = null;

  {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    selectedDate = todayStr();
  }

  const calMonthLabel = document.getElementById('cal-month-label');
  const calWeekdays = document.getElementById('cal-weekdays');
  const calDays = document.getElementById('cal-days');
  const calDayDetail = document.getElementById('cal-day-detail');

  // Date to restore keyboard focus to right after the next render — set by
  // both clicks and arrow-key navigation so focus never gets silently
  // dropped to <body> when the grid's DOM is rebuilt from scratch.
  let pendingFocusDate = null;

  const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  calWeekdays.setAttribute('role', 'row');
  calWeekdays.innerHTML = WEEKDAY_NAMES.map((d) => `<div role="columnheader">${d}</div>`).join('');

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
  document.getElementById('cal-today').addEventListener('click', () => {
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    pendingFocusDate = todayStr();
    renderCalendar();
  });

  function dateKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function shiftDateKey(key, deltaDays) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d + deltaDays);
    return dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
  }

  function isInMonth(dateStr, year, month) {
    return !!dateStr && dateStr.slice(0, 7) === `${year}-${String(month + 1).padStart(2, '0')}`;
  }

  // Arrow keys move focus by day/week, Home/End jump to the start/end of
  // the row — the standard ARIA grid keyboard pattern. Moving past the
  // edge of the visible month navigates into the next/previous one, same
  // as a native date picker, rather than stopping dead at the 1st/last.
  function handleCalDayKeydown(e, key) {
    let targetKey;
    if (e.key === 'ArrowLeft') targetKey = shiftDateKey(key, -1);
    else if (e.key === 'ArrowRight') targetKey = shiftDateKey(key, 1);
    else if (e.key === 'ArrowUp') targetKey = shiftDateKey(key, -7);
    else if (e.key === 'ArrowDown') targetKey = shiftDateKey(key, 7);
    else if (e.key === 'Home' || e.key === 'End') {
      const [y, m, d] = key.split('-').map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      targetKey = shiftDateKey(key, e.key === 'Home' ? -dow : 6 - dow);
    } else {
      return;
    }
    e.preventDefault();
    const [ty, tm] = targetKey.split('-').map(Number);
    calYear = ty;
    calMonth = tm - 1;
    pendingFocusDate = targetKey;
    renderCalendar();
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

    // Exactly one cell is a keyboard tab stop (roving tabindex); the rest
    // are reached by arrow keys, not Tab. Prefer the selected day if it's
    // in view, else today if it's in view, else just the 1st of the month.
    const rovingDate = isInMonth(selectedDate, calYear, calMonth) ? selectedDate
      : isInMonth(today, calYear, calMonth) ? today
      : dateKey(calYear, calMonth, 1);

    calDays.innerHTML = '';
    calDays.setAttribute('role', 'grid');
    calDays.setAttribute('aria-label', calMonthLabel.textContent);

    let weekRow = null;
    let dayIndexInWeek = 0;
    function startWeekRow() {
      weekRow = document.createElement('div');
      weekRow.className = 'cal-week-row';
      weekRow.setAttribute('role', 'row');
      calDays.appendChild(weekRow);
    }
    function addFiller() {
      const filler = document.createElement('div');
      filler.className = 'cal-day empty';
      filler.setAttribute('aria-hidden', 'true');
      weekRow.appendChild(filler);
      dayIndexInWeek++;
    }

    startWeekRow();
    for (let i = 0; i < firstDow; i++) addFiller();

    for (let d = 1; d <= daysInMonth; d++) {
      if (dayIndexInWeek === 7) { startWeekRow(); dayIndexInWeek = 0; }
      const key = dateKey(calYear, calMonth, d);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-day';
      cell.setAttribute('role', 'gridcell');
      cell.dataset.date = key;
      cell.tabIndex = key === rovingDate ? 0 : -1;
      if (key === today) {
        cell.classList.add('today');
        cell.setAttribute('aria-current', 'date');
      }
      if (key === selectedDate) cell.classList.add('selected');

      const dayItems = byDate.get(key) || [];
      let dotsHtml = '';
      if (dayItems.length) {
        const allColors = [...new Set(dayItems.map((a) => subjectColor(a.subject)))];
        const shown = allColors.slice(0, 4);
        const extra = allColors.length - shown.length;
        dotsHtml = `<div class="cal-dots">${shown.map((c) => `<span class="cal-dot" style="background:${c}"></span>`).join('')}${extra > 0 ? `<span class="cal-more">+${extra}</span>` : ''}</div>`;
      }
      cell.innerHTML = `<span>${d}</span>${dotsHtml}`;
      const friendlyDate = formatDate(key);
      cell.setAttribute('aria-label', `${friendlyDate}${dayItems.length ? `, ${dayItems.length} assignment${dayItems.length === 1 ? '' : 's'}` : ''}`);
      cell.addEventListener('click', () => {
        selectedDate = key;
        pendingFocusDate = key;
        renderCalendar();
        // The day view lives below the grid, easy to tap a day and never
        // notice it updated — bring it into view so the tap visibly does
        // something instead of looking like a dead button.
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        calDayDetail.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
      });
      cell.addEventListener('keydown', (e) => handleCalDayKeydown(e, key));
      weekRow.appendChild(cell);
      dayIndexInWeek++;
    }
    while (dayIndexInWeek > 0 && dayIndexInWeek < 7) addFiller();

    renderDayDetail(byDate);

    if (pendingFocusDate) {
      const target = calDays.querySelector(`[data-date="${pendingFocusDate}"]`);
      if (target) target.focus();
      pendingFocusDate = null;
    }
  }

  function renderDayDetail(byDate) {
    if (!selectedDate) {
      calDayDetail.innerHTML = '<h3>Day view</h3><p class="empty-state">Click a day to see its assignments.</p>';
      return;
    }

    if (!isInMonth(selectedDate, calYear, calMonth)) {
      const monthName = new Date(calYear, calMonth, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      calDayDetail.innerHTML = `<h3>${monthName}</h3><p class="empty-state">Click a day in this month to view assignments.</p>`;
      return;
    }

    const items = (byDate.get(selectedDate) || []).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    if (!items.length) {
      calDayDetail.innerHTML = `<h3>${formatDate(selectedDate)}</h3><p class="empty-state">No assignments due on this date.</p>`;
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'item-list';
    for (const a of items) ul.appendChild(renderItem(a, { showSubject: true, showNotes: true }));
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
      // Only trust selectedDate if it's actually visible right now — it
      // can go stale after navigating months away from it, and using it
      // then would silently default Add to a day nothing on screen
      // indicates is "selected" anymore.
      fDate.value = (!TABS.calendar.view.hidden && isInMonth(selectedDate, calYear, calMonth)) ? selectedDate : todayStr();
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
    ensureSubject(fSubject.value.trim());
    saveAssignments(assignments);
    dialog.close();
    renderChecklist();
    renderUpcoming();
    renderCalendar();
    renderSubjectManageList();
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
    renderUpcoming();
    renderCalendar();
    scheduleSync();
  });

  dialog.addEventListener('cancel', () => dialog.close());

  /* ---------- subject management ---------- */

  const subjectDialog = document.getElementById('subject-dialog');
  const subjectForm = document.getElementById('subject-form');
  const subjectDialogTitle = document.getElementById('subject-dialog-title');
  const fsId = document.getElementById('fs-id');
  const fsName = document.getElementById('fs-name');
  const subjectColorSwatches = document.getElementById('subject-color-swatches');
  const btnSubjectDelete = document.getElementById('btn-subject-delete');
  const subjectManageList = document.getElementById('subject-manage-list');

  let pickedSubjectColor = SUBJECT_PALETTE[0];

  function renderSubjectColorSwatches() {
    subjectColorSwatches.innerHTML = '';
    for (const color of SUBJECT_PALETTE) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-swatch';
      btn.style.setProperty('--swatch', color);
      btn.setAttribute('aria-label', color);
      btn.setAttribute('aria-pressed', String(color === pickedSubjectColor));
      btn.addEventListener('click', () => {
        pickedSubjectColor = color;
        renderSubjectColorSwatches();
      });
      subjectColorSwatches.appendChild(btn);
    }
  }

  function openSubjectDialog(subject) {
    subjectForm.reset();
    if (subject) {
      subjectDialogTitle.textContent = 'Edit subject';
      fsId.value = subject.id;
      fsName.value = subject.name;
      pickedSubjectColor = subject.color;
      btnSubjectDelete.hidden = false;
    } else {
      subjectDialogTitle.textContent = 'Add subject';
      fsId.value = '';
      pickedSubjectColor = SUBJECT_PALETTE[randomInt(SUBJECT_PALETTE.length)];
      btnSubjectDelete.hidden = true;
    }
    renderSubjectColorSwatches();
    subjectDialog.showModal();
    fsName.focus();
  }

  function renderSubjectManageList() {
    const list = visibleSubjects().slice().sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) {
      subjectManageList.innerHTML = '<li class="dialog-help subject-manage-empty">No subjects yet — add one below, or it\'ll show up automatically the first time you assign it to something.</li>';
      return;
    }
    subjectManageList.innerHTML = '';
    for (const s of list) {
      const li = document.createElement('li');
      li.className = 'subject-manage-row';
      li.innerHTML = `
        <span class="subject-dot" style="background:${s.color}"></span>
        <button type="button" class="subject-manage-name">${escapeHtml(s.name)}</button>
        <button type="button" class="btn icon-btn" aria-label="Delete ${escapeHtml(s.name)}" title="Delete">×</button>
      `;
      li.querySelector('.subject-manage-name').addEventListener('click', () => openSubjectDialog(s));
      li.querySelector('.btn.icon-btn').addEventListener('click', () => deleteSubject(s));
      subjectManageList.appendChild(li);
    }
  }

  // Subjects are never cascade-deleted with their assignments — those
  // reference a subject by name, not id, so removing the subject record
  // just stops it being pinned to the checklist; it reappears on its own
  // if it still has assignments (see allSubjectNames()).
  async function deleteSubject(s) {
    if (!(await appConfirm(`Delete "${s.name}"? Its assignments won't be deleted — the subject just stops being pinned to the list.`))) return false;
    s.deleted = true;
    s.updatedAt = Date.now();
    saveSubjects(subjects);
    renderChecklist();
    renderUpcoming();
    renderCalendar();
    renderSubjectManageList();
    scheduleSync();
    return true;
  }

  document.getElementById('btn-subject-add').addEventListener('click', () => openSubjectDialog(null));
  document.getElementById('btn-subject-cancel').addEventListener('click', () => subjectDialog.close());
  subjectDialog.addEventListener('cancel', () => subjectDialog.close());

  subjectForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = fsName.value.trim();
    if (!name) return;

    if (fsId.value) {
      const s = subjects.find((x) => x.id === fsId.value);
      if (s) {
        if (s.name !== name) {
          // Cascade the rename onto every assignment filed under the old
          // name, since assignments reference subjects by name, not id.
          for (const a of assignments) {
            if (a.subject === s.name) { a.subject = name; a.updatedAt = Date.now(); }
          }
          saveAssignments(assignments);
        }
        s.name = name;
        s.color = pickedSubjectColor;
        s.updatedAt = Date.now();
      }
    } else {
      const existing = subjects.find((x) => x.name === name && !x.deleted);
      if (existing) {
        existing.color = pickedSubjectColor;
        existing.updatedAt = Date.now();
      } else {
        subjects.push({ id: uid(), name, color: pickedSubjectColor, updatedAt: Date.now() });
      }
    }
    saveSubjects(subjects);
    subjectDialog.close();
    renderChecklist();
    renderUpcoming();
    renderCalendar();
    renderSubjectManageList();
    scheduleSync();
  });

  btnSubjectDelete.addEventListener('click', async () => {
    if (!fsId.value) return;
    const s = subjects.find((x) => x.id === fsId.value);
    if (!s) return;
    if (await deleteSubject(s)) subjectDialog.close();
  });

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

    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Assignment Calendar//Paramedic Assignments//EN', 'CALSCALE:GREGORIAN'];

    for (const a of list) {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${a.id}@assignment-calendar.local`);
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
    a.download = `assignment-calendar-${todayStr()}.ics`;
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
    { id: 'emerald', label: 'Emerald', light: '#127d44', dark: '#5ae29a' },
    { id: 'amber', label: 'Amber', light: '#9c641c', dark: '#e2a75a' },
    { id: 'arml', label: 'ARML', light: '#961200', dark: '#f2705f' },
  ];

  function getStoredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && THEMES.some((t) => t.id === saved)) return saved;
    localStorage.setItem(THEME_KEY, 'ihcc');
    return 'ihcc';
  }

  function applyTheme(id) {
    const nextTheme = THEMES.some((t) => t.id === id) ? id : 'ihcc';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
    renderThemeSwatches();
  }

  const themeSwatchesEl = document.getElementById('theme-swatches');

  function renderThemeSwatches() {
    const current = getStoredTheme();
    const isDark = resolveMode() === 'dark';
    themeSwatchesEl.innerHTML = '';
    for (const t of THEMES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-swatch';
      btn.style.setProperty('--swatch', isDark ? t.dark : t.light);
      btn.setAttribute('aria-label', t.label);
      btn.setAttribute('aria-pressed', String(t.id === current));
      btn.title = t.label;
      btn.addEventListener('click', () => applyTheme(t.id));
      themeSwatchesEl.appendChild(btn);
    }
  }

  /* ---------- light/dark override ----------
   * Follows the system by default (same as before this existed); touching
   * the pill in Settings pins an explicit choice that overrides the
   * system from then on — same "only the non-default state gets written
   * to storage" idea as ARML's own toggle, just built on a system-
   * following default instead of ARML's fixed dark default.
   */
  const MODE_KEY = 'feldkamp-mode';
  const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const modeToggleBtn = document.getElementById('mode-toggle');

  function resolveMode() {
    return localStorage.getItem(MODE_KEY) || (darkMediaQuery.matches ? 'dark' : 'light');
  }

  function applyMode(mode) {
    document.documentElement.setAttribute('data-mode', mode);
  }

  function renderModeToggle() {
    const isLight = resolveMode() === 'light';
    const nextLabel = isLight ? 'Switch to dark theme' : 'Switch to light theme';
    modeToggleBtn.setAttribute('aria-pressed', String(isLight));
    modeToggleBtn.setAttribute('aria-label', nextLabel);
    modeToggleBtn.title = nextLabel;
  }

  function setExplicitMode(mode) {
    localStorage.setItem(MODE_KEY, mode);
    applyMode(mode);
    renderModeToggle();
    renderThemeSwatches();
  }

  modeToggleBtn.addEventListener('click', () => {
    setExplicitMode(resolveMode() === 'dark' ? 'light' : 'dark');
  });

  // Stay in sync with the OS/browser setting for as long as nobody has
  // explicitly overridden it.
  darkMediaQuery.addEventListener('change', () => {
    if (localStorage.getItem(MODE_KEY)) return;
    applyMode(resolveMode());
    renderModeToggle();
    renderThemeSwatches();
  });

  applyMode(resolveMode());
  renderModeToggle();
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
    const lists = readJson(LISTS_KEY, []);
    return Array.isArray(lists) ? lists : [];
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
    if (res.status === 404) return { found: false, name: '', assignments: [], subjects: [] };
    if (!res.ok) throw new Error(await firestoreErrorMessage(res));
    const doc = await res.json();
    const raw = doc.fields && doc.fields.data && doc.fields.data.stringValue;
    try {
      const parsed = JSON.parse(raw || '{}');
      return {
        found: true,
        name: parsed.name || '',
        assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
        subjects: Array.isArray(parsed.subjects) ? parsed.subjects : [],
      };
    } catch {
      return { found: true, name: '', assignments: [], subjects: [] };
    }
  }

  async function pushRemote(code, name, list, subjectList) {
    const res = await firestoreFetch(`/syncCodes/${code}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields: { data: { stringValue: JSON.stringify({ name, assignments: list, subjects: subjectList }) } } }),
    });
    if (!res.ok) throw new Error(await firestoreErrorMessage(res));
  }

  function pruneTombstones(list) {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    return list.filter((a) => !a.deleted || (a.updatedAt || 0) > cutoff);
  }

  // Last-write-wins merge by id, used for both assignments and subjects.
  function mergeById(localList, remoteList) {
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
      const mergedAssignments = mergeById(assignments, remote.assignments);
      const mergedSubjects = mergeById(subjects, remote.subjects);

      let changed = false;
      if (stableKey(mergedAssignments) !== stableKey(assignments)) {
        assignments = mergedAssignments;
        saveAssignments(assignments);
        changed = true;
      }
      if (stableKey(mergedSubjects) !== stableKey(subjects)) {
        subjects = mergedSubjects;
        saveSubjects(subjects);
        changed = true;
      }
      if (changed) {
        renderChecklist();
        renderUpcoming();
        renderCalendar();
        renderSubjectManageList();
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

      if (stableKey(mergedAssignments) !== stableKey(remote.assignments) ||
          stableKey(mergedSubjects) !== stableKey(remote.subjects) ||
          entry.name !== remote.name) {
        await pushRemote(code, entry.name, mergedAssignments, mergedSubjects);
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
        const mergedAssignments = mergeById(assignments, remoteCurrent.assignments);
        const mergedSubjects = mergeById(subjects, remoteCurrent.subjects);
        const currentEntry = getLists().find((l) => l.code === currentCode);
        if (stableKey(mergedAssignments) !== stableKey(remoteCurrent.assignments) ||
            stableKey(mergedSubjects) !== stableKey(remoteCurrent.subjects)) {
          await pushRemote(currentCode, currentEntry ? currentEntry.name : '', mergedAssignments, mergedSubjects);
        }
      }
      const remoteNew = await pullRemote(newCode);
      assignments = pruneTombstones(remoteNew.assignments);
      subjects = pruneTombstones(remoteNew.subjects);
      saveAssignments(assignments);
      saveSubjects(subjects);
      setActiveCode(newCode);
      localStorage.setItem(LAST_SYNCED_KEY, String(Date.now()));
      renderChecklist();
      renderUpcoming();
      renderCalendar();
      renderSubjectManageList();
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
    if (!code) {
      lastSyncError = 'Enter a valid sync code first.';
      renderSyncStatusText();
      return;
    }
    const lists = getLists();
    if (lists.some((l) => l.code === code)) {
      await switchActiveCode(code);
      input.value = '';
      return;
    }
    setSyncButtonBusy(true);
    try {
      const remote = await pullRemote(code);
      if (!remote.found) {
        lastSyncError = 'That code was not found. Double-check it and try again.';
        renderSyncStatusText();
        return;
      }
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
    renderSubjectManageList();
    syncDialog.showModal();
  }

  document.getElementById('btn-sync').addEventListener('click', async () => {
    if (!isSyncEnabled()) localStorage.setItem(SYNC_ENABLED_KEY, '1');
    await syncNow();
  });
  document.getElementById('btn-sync-settings').addEventListener('click', openSyncDialog);
  document.getElementById('btn-sync-cancel').addEventListener('click', () => syncDialog.close());
  document.getElementById('btn-sync-close').addEventListener('click', () => syncDialog.close());
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
