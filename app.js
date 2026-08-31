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
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveAssignments(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
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
    return [...new Set(assignments.map((a) => a.subject))].sort((a, b) => a.localeCompare(b));
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

    let list = assignments.slice();
    if (subjectFilter) list = list.filter((a) => a.subject === subjectFilter);
    if (hideDone) list = list.filter((a) => !a.done);

    checklistGroups.innerHTML = '';
    checklistEmpty.hidden = assignments.length > 0;

    if (list.length === 0) {
      checklistGroups.innerHTML = assignments.length
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
      saveAssignments(assignments);
      renderChecklist();
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
    for (const a of assignments) {
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
      });
    }
    saveAssignments(assignments);
    dialog.close();
    renderChecklist();
    renderCalendar();
  });

  btnDelete.addEventListener('click', () => {
    if (!fId.value) return;
    if (!confirm('Delete this assignment?')) return;
    assignments = assignments.filter((x) => x.id !== fId.value);
    saveAssignments(assignments);
    dialog.close();
    renderChecklist();
    renderCalendar();
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
    if (!assignments.length) {
      alert('No assignments to export yet.');
      return;
    }
    const ics = buildIcs(assignments);
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

  /* ---------- offline banner ---------- */

  const offlineBanner = document.getElementById('offline-banner');
  function updateOnlineStatus() {
    offlineBanner.hidden = navigator.onLine;
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  /* ---------- service worker ---------- */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  /* ---------- init ---------- */

  renderChecklist();
})();
