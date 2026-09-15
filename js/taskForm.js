import { ICONS } from './icons.js';
import {
  WEEKDAY_LABELS, WEEKDAY_NAMES, todayWeekdayIndex,
  weekdayIndexForDate, dateForWeekdayIndex,
} from './date.js';

let els = {};
let state = null;

export function initTaskForm() {
  els = {
    overlay: document.getElementById('taskFormOverlay'),
    title: document.getElementById('taskFormTitle'),
    close: document.getElementById('taskFormClose'),
    name: document.getElementById('taskNameInput'),
    nameError: document.getElementById('taskNameError'),
    category: document.getElementById('taskCategoryInput'),
    timePicker: document.getElementById('timePicker'),
    timeError: document.getElementById('taskTimeError'),
    quickPicker: document.getElementById('quickPicker'),
    dayPicker: document.getElementById('dayPicker'),
    daySummary: document.getElementById('daySummary'),
    save: document.getElementById('taskFormSave'),
    cancel: document.getElementById('taskFormCancel'),
  };

  els.close.innerHTML = ICONS.close;
  els.timePicker.querySelector('[data-time="morning"]').innerHTML = `${ICONS.sun}Morning`;
  els.timePicker.querySelector('[data-time="afternoon"]').innerHTML = `${ICONS.cloud}Afternoon`;
  els.timePicker.querySelector('[data-time="evening"]').innerHTML = `${ICONS.moon}Evening`;
  els.dayPicker.innerHTML = WEEKDAY_LABELS
    .map((label, i) => `<button type="button" class="day-btn" data-day="${i}">${label}</button>`)
    .join('');

  els.timePicker.querySelectorAll('.picker-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedTime = btn.dataset.time;
      els.timeError.classList.remove('visible');
      paintTime();
    });
  });

  els.dayPicker.querySelectorAll('.day-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const day = Number(btn.dataset.day);
      if (state.onceMode) {
        // One-off tasks pin to a single day this week — tapping another
        // circle just moves which day, it doesn't add a second one.
        state.selectedDays = new Set([day]);
      } else if (state.selectedDays.has(day)) {
        state.selectedDays.delete(day);
      } else {
        state.selectedDays.add(day);
      }
      paintDays();
    });
  });

  els.quickPicker.querySelectorAll('.quick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const quick = btn.dataset.quick;
      if (quick === 'everyday') {
        state.onceMode = false;
        state.selectedDays = new Set([0, 1, 2, 3, 4, 5, 6]);
      } else if (quick === 'weekdays') {
        state.onceMode = false;
        state.selectedDays = new Set([0, 1, 2, 3, 4]);
      } else if (quick === 'once') {
        state.onceMode = true;
        const existing = [...state.selectedDays][0];
        state.selectedDays = new Set([existing !== undefined ? existing : state.defaultDay]);
      }
      paintDays();
    });
  });

  els.close.addEventListener('click', closeForm);
  els.cancel.addEventListener('click', closeForm);
  els.save.addEventListener('click', onSaveClick);
  els.overlay.addEventListener('click', (e) => {
    if (e.target === els.overlay) closeForm();
  });
}

function paintTime() {
  els.timePicker.querySelectorAll('.picker-btn').forEach((b) => {
    b.classList.toggle('selected', b.dataset.time === state.selectedTime);
  });
}

function isExactly(set, arr) {
  return set.size === arr.length && arr.every((d) => set.has(d));
}

function paintDays() {
  els.dayPicker.querySelectorAll('.day-btn').forEach((b, i) => {
    b.classList.toggle('selected', state.selectedDays.has(i));
  });
  els.quickPicker.querySelectorAll('.quick-btn').forEach((b) => {
    const quick = b.dataset.quick;
    const on = quick === 'once'
      ? state.onceMode
      : !state.onceMode && (
        quick === 'everyday' ? isExactly(state.selectedDays, [0, 1, 2, 3, 4, 5, 6])
          : isExactly(state.selectedDays, [0, 1, 2, 3, 4])
      );
    b.classList.toggle('selected', on);
  });
  els.daySummary.style.color = '';

  const n = state.selectedDays.size;
  if (state.onceMode) {
    const idx = [...state.selectedDays][0];
    els.daySummary.textContent = `Just once — this week's ${WEEKDAY_NAMES[idx]}.`;
  } else if (n === 0) {
    els.daySummary.textContent = 'Select which days this applies to.';
  } else if (n === 7) {
    els.daySummary.textContent = 'Repeats every day.';
  } else if (n === 1) {
    const idx = [...state.selectedDays][0];
    els.daySummary.textContent = `Repeats every ${WEEKDAY_NAMES[idx]}.`;
  } else {
    const names = [...state.selectedDays].sort((a, b) => a - b).map((i) => WEEKDAY_NAMES[i]).join(', ');
    els.daySummary.textContent = `Repeats on ${names}.`;
  }
}

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

function closeForm() {
  hide(els.overlay);
  state = null;
}

function resetErrors() {
  els.nameError.classList.remove('visible');
  els.timeError.classList.remove('visible');
  els.daySummary.style.color = '';
}

function onSaveClick() {
  const name = els.name.value.trim();
  if (!name) {
    els.nameError.classList.add('visible');
    els.name.focus();
    return;
  }
  if (!state.selectedTime) {
    els.timeError.classList.add('visible');
    return;
  }
  if (state.selectedDays.size === 0) {
    els.daySummary.style.color = 'var(--text-danger)';
    return;
  }

  const days = [...state.selectedDays].sort((a, b) => a - b);
  const recurrence = state.onceMode
    ? { type: 'once', date: dateForWeekdayIndex(days[0]) }
    : { type: 'days', days };

  const formData = {
    name,
    category: els.category.value.trim() || 'other',
    timeOfDay: state.selectedTime,
    recurrence,
  };

  const onSubmit = state.onSubmit;
  closeForm();
  onSubmit(formData);
}

export function openTaskFormForAdd(onSubmit, defaultDay = todayWeekdayIndex()) {
  state = {
    selectedTime: null, selectedDays: new Set(), onceMode: false, defaultDay, onSubmit,
  };
  els.title.textContent = 'Add task';
  els.save.textContent = 'Save task';
  els.name.value = '';
  els.category.value = '';
  resetErrors();
  paintTime();
  paintDays();
  show(els.overlay);
  els.name.focus();
}

export function openTaskFormForEdit(task, onSubmit) {
  const days = task.recurrence.type === 'once'
    ? [weekdayIndexForDate(task.recurrence.date)]
    : [...task.recurrence.days];
  state = {
    selectedTime: task.timeOfDay,
    selectedDays: new Set(days),
    onceMode: task.recurrence.type === 'once',
    onSubmit,
  };
  els.title.textContent = 'Edit task';
  els.save.textContent = 'Save changes';
  els.name.value = task.name;
  els.category.value = task.category;
  resetErrors();
  paintTime();
  paintDays();
  show(els.overlay);
}
