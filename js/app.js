import { Tasks, Exceptions, Completions, deleteTaskCascade } from './db.js';
import { buildListForDate, groupByTimeOfDay } from './occurrences.js';
import {
  todayISO, todayWeekdayIndex, getWeekDates, weekdayIndexForDate,
  WEEKDAY_NAMES, WEEKDAY_LABELS, formatMonthDay,
} from './date.js';
import { emojiForCategory, tintForCategory } from './categories.js';
import { ICONS } from './icons.js';
import { initTaskForm, openTaskFormForAdd, openTaskFormForEdit } from './taskForm.js';
import { initActionSheet, openActionSheet } from './actionSheet.js';
import { downloadExport, importFromFile } from './backup.js';

const listContainer = document.getElementById('listContainer');
const dayHeading = document.getElementById('dayHeading');
const dateSub = document.getElementById('dateSub');
const dayStrip = document.getElementById('dayStrip');
const toast = document.getElementById('toast');
let toastTimer = null;

let selectedWeekday = todayWeekdayIndex();
let selectedDate = todayISO();

function dayPhrase(dateISO) {
  return dateISO === todayISO() ? 'today' : WEEKDAY_NAMES[weekdayIndexForDate(dateISO)];
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
}

const SECTION_META = {
  morning: { label: 'Morning', icon: ICONS.sun },
  afternoon: { label: 'Afternoon', icon: ICONS.cloud },
  evening: { label: 'Evening', icon: ICONS.moon },
};

async function refresh() {
  const [tasks, exceptions, completions] = await Promise.all([
    Tasks.getAll(),
    Exceptions.getAll(),
    Completions.getAll(),
  ]);
  render(buildListForDate(tasks, exceptions, completions, selectedDate, selectedWeekday));
}

function render(items) {
  const groups = groupByTimeOfDay(items);
  listContainer.innerHTML = '';

  if (items.length === 0) {
    const isToday = selectedDate === todayISO();
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = isToday
      ? 'Nothing on the list for today. Tap + to add a task.'
      : `Nothing on ${WEEKDAY_NAMES[selectedWeekday]}'s list. Tap + to add a task.`;
    listContainer.appendChild(empty);
    return;
  }

  for (const key of ['morning', 'afternoon', 'evening']) {
    const groupItems = groups[key];
    if (groupItems.length === 0) continue;

    const section = document.createElement('section');
    section.className = 'section';

    const title = document.createElement('p');
    title.className = 'section-title';
    title.innerHTML = `${SECTION_META[key].icon}${SECTION_META[key].label}`;
    section.appendChild(title);

    const list = document.createElement('div');
    list.className = 'task-list';
    groupItems.forEach((item) => list.appendChild(renderTaskRow(item)));
    section.appendChild(list);

    listContainer.appendChild(section);
  }
}

function renderTaskRow(item) {
  const row = document.createElement('div');
  row.className = 'task-row' + (item.completed ? ' completed' : '');

  const checkbox = document.createElement('button');
  checkbox.type = 'button';
  checkbox.className = 'task-checkbox';
  checkbox.setAttribute('aria-label', item.completed ? 'Mark not done' : 'Mark done');
  checkbox.innerHTML = ICONS.check;
  checkbox.addEventListener('click', () => toggleCompletion(item));

  const labelBtn = document.createElement('button');
  labelBtn.type = 'button';
  labelBtn.className = 'task-label-btn';

  const name = document.createElement('span');
  name.className = 'task-name';
  name.textContent = item.task.name;
  labelBtn.appendChild(name);

  if (item.hasOverride) {
    const note = document.createElement('span');
    note.className = 'task-override-note';
    note.textContent = 'Edited for today only';
    labelBtn.appendChild(note);
  }
  labelBtn.addEventListener('click', () => openActionSheet(item));

  const tag = document.createElement('span');
  tag.className = `tag tag-${tintForCategory(item.task.category)}`;
  tag.textContent = `${emojiForCategory(item.task.category)} ${item.task.category}`;

  row.appendChild(checkbox);
  row.appendChild(labelBtn);
  row.appendChild(tag);
  return row;
}

async function toggleCompletion(item) {
  const taskId = item.sourceTask.id;
  const date = item.date;
  if (item.completed) {
    await Completions.delete(taskId, date);
  } else {
    await Completions.put({ taskId, date, completedAt: Date.now() });
  }
  await refresh();
}

// ---------- Day strip (see the week / jump to a day) ----------
function updateHeader() {
  const isToday = selectedDate === todayISO();
  dayHeading.textContent = isToday ? 'Today' : WEEKDAY_NAMES[selectedWeekday];
  dateSub.textContent = formatMonthDay(selectedDate);
}

function renderDayStrip() {
  const weekDates = getWeekDates();
  const todayDate = todayISO();
  dayStrip.innerHTML = '';

  weekDates.forEach((date, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-strip-btn';
    if (date === todayDate) btn.classList.add('today');
    if (idx === selectedWeekday) btn.classList.add('selected');

    const dow = document.createElement('span');
    dow.className = 'dow';
    dow.textContent = WEEKDAY_LABELS[idx];

    const dom = document.createElement('span');
    dom.className = 'dom';
    dom.textContent = String(Number(date.slice(-2)));

    btn.appendChild(dow);
    btn.appendChild(dom);
    if (date === todayDate) {
      const dot = document.createElement('span');
      dot.className = 'today-dot';
      btn.appendChild(dot);
    }

    btn.addEventListener('click', () => selectDay(idx));
    dayStrip.appendChild(btn);
  });
}

function selectDay(idx) {
  if (idx === selectedWeekday) return;
  selectedWeekday = idx;
  selectedDate = getWeekDates()[idx];
  updateHeader();
  renderDayStrip();
  refresh();
}

// Swipe left/right over the task list to move to the next/previous day,
// clamped to the current week (the app doesn't track other weeks).
let touchStartX = 0;
let touchStartY = 0;
listContainer.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}, { passive: true });

listContainer.addEventListener('touchend', (e) => {
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  const next = selectedWeekday + (dx < 0 ? 1 : -1);
  if (next < 0 || next > 6) return;
  selectDay(next);
}, { passive: true });

// ---------- Add task ----------
const addTaskFab = document.getElementById('addTaskFab');
addTaskFab.innerHTML = ICONS.plus;
addTaskFab.addEventListener('click', () => {
  openTaskFormForAdd(async (formData) => {
    const task = {
      id: crypto.randomUUID(),
      name: formData.name,
      category: formData.category,
      timeOfDay: formData.timeOfDay,
      recurrence: formData.recurrence,
      createdAt: Date.now(),
    };
    await Tasks.put(task);
    await refresh();
    showToast('Task added.');
  }, selectedWeekday);
});

// ---------- Edit / delete (via action sheet) ----------
initActionSheet({
  onEdit: (item) => {
    openTaskFormForEdit(item.sourceTask, (formData) => handleEditSubmit(item, formData));
  },
  onDeleteOnce: async (item) => {
    await Exceptions.put({ taskId: item.sourceTask.id, date: item.date, type: 'skip' });
    await refresh();
    showToast(`Removed for ${dayPhrase(item.date)}.`);
  },
  onDeleteAll: async (item) => {
    await deleteTaskCascade(item.sourceTask.id);
    await refresh();
    showToast('Task deleted.');
  },
});

function sameRecurrence(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'once') return a.date === b.date;
  return a.days.length === b.days.length && a.days.every((d, i) => d === b.days[i]);
}

const editScopeOverlay = document.getElementById('editScopeOverlay');
const editScopeSubtitle = document.getElementById('editScopeSubtitle');
const editScopeOnceBtn = document.getElementById('editScopeOnce');
const editScopeAllBtn = document.getElementById('editScopeAll');
const editScopeCancelBtn = document.getElementById('editScopeCancel');
let pendingScopeEdit = null;

async function handleEditSubmit(item, formData) {
  const source = item.sourceTask;

  if (source.recurrence.type === 'once') {
    await Tasks.put({ ...source, ...formData });
    await refresh();
    showToast('Task updated.');
    return;
  }

  const recurrenceChanged = !sameRecurrence(formData.recurrence, source.recurrence);
  const fieldsChanged = formData.name !== source.name
    || formData.category !== source.category
    || formData.timeOfDay !== source.timeOfDay;

  if (!recurrenceChanged && !fieldsChanged) return;

  if (recurrenceChanged) {
    await Tasks.put({ ...source, ...formData });
    await Exceptions.delete(source.id, item.date);
    await refresh();
    showToast('Series updated.');
    return;
  }

  pendingScopeEdit = { source, formData, date: item.date };
  const dayNames = source.recurrence.days.map((i) => WEEKDAY_NAMES[i]).join(', ');
  editScopeSubtitle.textContent = `This task repeats on ${dayNames}.`;
  const phrase = dayPhrase(item.date);
  editScopeOnceBtn.textContent = phrase === 'today' ? 'Just today' : `Just ${phrase}`;
  editScopeOverlay.hidden = false;
}

editScopeCancelBtn.addEventListener('click', () => {
  editScopeOverlay.hidden = true;
  pendingScopeEdit = null;
});
editScopeOverlay.addEventListener('click', (e) => {
  if (e.target === editScopeOverlay) {
    editScopeOverlay.hidden = true;
    pendingScopeEdit = null;
  }
});

editScopeOnceBtn.addEventListener('click', async () => {
  const { source, formData, date } = pendingScopeEdit;
  const overrides = {};
  if (formData.name !== source.name) overrides.name = formData.name;
  if (formData.category !== source.category) overrides.category = formData.category;
  if (formData.timeOfDay !== source.timeOfDay) overrides.timeOfDay = formData.timeOfDay;
  await Exceptions.put({ taskId: source.id, date, type: 'override', overrides });
  editScopeOverlay.hidden = true;
  pendingScopeEdit = null;
  await refresh();
  showToast(`Changed for ${dayPhrase(date)} only.`);
});

editScopeAllBtn.addEventListener('click', async () => {
  const { source, formData, date } = pendingScopeEdit;
  await Tasks.put({ ...source, ...formData });
  await Exceptions.delete(source.id, date);
  editScopeOverlay.hidden = true;
  pendingScopeEdit = null;
  await refresh();
  showToast('Series updated.');
});

// ---------- Backup (export / import) ----------
const settingsOverlay = document.getElementById('settingsOverlay');
const settingsBtn = document.getElementById('settingsBtn');
const settingsClose = document.getElementById('settingsClose');
settingsBtn.innerHTML = ICONS.dots;
settingsClose.innerHTML = ICONS.close;
settingsBtn.addEventListener('click', () => { settingsOverlay.hidden = false; });
settingsClose.addEventListener('click', () => { settingsOverlay.hidden = true; });
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.hidden = true;
});

const exportBtn = document.getElementById('exportBtn');
exportBtn.innerHTML = `${ICONS.download}<span>Export data (JSON)</span>`;
exportBtn.addEventListener('click', async () => {
  await downloadExport();
  showToast('Backup downloaded.');
});

const importBtn = document.getElementById('importBtn');
importBtn.innerHTML = `${ICONS.upload}<span>Import data (JSON)</span>`;
const importFileInput = document.getElementById('importFileInput');
importBtn.addEventListener('click', () => importFileInput.click());
importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files[0];
  importFileInput.value = '';
  if (!file) return;
  const ok = window.confirm('This replaces all tasks and history currently stored on this device. Continue?');
  if (!ok) return;
  try {
    await importFromFile(file);
    settingsOverlay.hidden = true;
    await refresh();
    showToast('Backup imported.');
  } catch (err) {
    window.alert(err.message || 'Import failed.');
  }
});

// ---------- Boot ----------
updateHeader();
renderDayStrip();
initTaskForm();
refresh();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch((err) => {
        console.error('Service worker registration failed:', err);
      });
  });

  // When a new service worker takes over (e.g. after an app update ships),
  // reload once so the page is running the new cached assets instead of
  // whatever was already loaded in memory.
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    window.location.reload();
  });
}
