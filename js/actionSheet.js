import { ICONS } from './icons.js';
import { WEEKDAY_NAMES, todayISO, weekdayIndexForDate } from './date.js';

let els = {};
let callbacks = {};
let currentItem = null;

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

export function initActionSheet(cb) {
  callbacks = cb;
  els = {
    actionOverlay: document.getElementById('actionSheetOverlay'),
    actionTitle: document.getElementById('actionSheetTitle'),
    actionSubtitle: document.getElementById('actionSheetSubtitle'),
    editBtn: document.getElementById('actionEditBtn'),
    deleteBtn: document.getElementById('actionDeleteBtn'),
    cancelBtn: document.getElementById('actionCancelBtn'),

    confirmOverlay: document.getElementById('deleteConfirmOverlay'),
    confirmTitle: document.getElementById('deleteConfirmTitle'),
    onceBtn: document.getElementById('deleteOnceBtn'),
    allBtn: document.getElementById('deleteAllBtn'),
    confirmCancelBtn: document.getElementById('deleteCancelBtn'),
  };

  els.editBtn.innerHTML = `${ICONS.edit}<span>Edit task</span>`;
  els.deleteBtn.innerHTML = `${ICONS.trash}<span>Delete task</span>`;

  els.editBtn.addEventListener('click', () => {
    hide(els.actionOverlay);
    callbacks.onEdit(currentItem);
  });
  els.deleteBtn.addEventListener('click', showDeleteConfirm);
  els.cancelBtn.addEventListener('click', () => hide(els.actionOverlay));
  els.actionOverlay.addEventListener('click', (e) => {
    if (e.target === els.actionOverlay) hide(els.actionOverlay);
  });

  els.confirmCancelBtn.addEventListener('click', () => hide(els.confirmOverlay));
  els.confirmOverlay.addEventListener('click', (e) => {
    if (e.target === els.confirmOverlay) hide(els.confirmOverlay);
  });
  els.onceBtn.addEventListener('click', () => {
    hide(els.confirmOverlay);
    callbacks.onDeleteOnce(currentItem);
  });
  els.allBtn.addEventListener('click', () => {
    hide(els.confirmOverlay);
    callbacks.onDeleteAll(currentItem);
  });
}

export function openActionSheet(item) {
  currentItem = item;
  const task = item.task;
  const times = Array.isArray(task.timeOfDay) ? task.timeOfDay : [task.timeOfDay];
  const timeLabel = times.map((time) => time[0].toUpperCase() + time.slice(1)).join(', ');
  els.actionTitle.textContent = task.name;
  els.actionSubtitle.textContent = task.recurrence.type === 'once'
    ? `${timeLabel} · One-time task`
    : `${timeLabel} · Repeats ${task.recurrence.days.map((i) => WEEKDAY_NAMES[i]).join(', ')}`;
  show(els.actionOverlay);
}

// Jumps straight to the delete-confirm sheet for an item, skipping the
// Edit/Delete/Cancel sheet — used by the row swipe-to-delete action, where
// the gesture itself already signals delete intent.
export function openDeleteConfirmForItem(item) {
  currentItem = item;
  showDeleteConfirm();
}

function showDeleteConfirm() {
  hide(els.actionOverlay);
  const sourceTask = currentItem.sourceTask;

  if (sourceTask.recurrence.type === 'once') {
    els.confirmTitle.textContent = 'Delete this task?';
    els.onceBtn.hidden = true;
    els.allBtn.textContent = 'Delete';
  } else {
    const dayNames = sourceTask.recurrence.days.map((i) => WEEKDAY_NAMES[i]).join(', ');
    const viewedDayName = WEEKDAY_NAMES[weekdayIndexForDate(currentItem.date)];
    const isToday = currentItem.date === todayISO();
    els.confirmTitle.textContent = `This task repeats on ${dayNames}.`;
    els.onceBtn.hidden = false;
    els.onceBtn.textContent = isToday ? `Just today (${viewedDayName})` : `Just ${viewedDayName}`;
    els.allBtn.textContent = 'Remove from all days';
  }
  show(els.confirmOverlay);
}
