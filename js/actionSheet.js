import { WEEKDAY_NAMES, todayISO, weekdayIndexForDate } from './date.js';

let els = {};
let callbacks = {};
let currentItem = null;

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

export function initActionSheet(cb) {
  callbacks = cb;
  els = {
    confirmOverlay: document.getElementById('deleteConfirmOverlay'),
    confirmTitle: document.getElementById('deleteConfirmTitle'),
    onceBtn: document.getElementById('deleteOnceBtn'),
    allBtn: document.getElementById('deleteAllBtn'),
    confirmCancelBtn: document.getElementById('deleteCancelBtn'),
  };

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

// Jumps straight to the delete-confirm sheet for an item — reached via the
// row's swipe-to-delete action, where the gesture itself already signals
// delete intent, so there's no separate Edit/Delete/Cancel chooser first.
export function openDeleteConfirmForItem(item) {
  currentItem = item;
  showDeleteConfirm();
}

function showDeleteConfirm() {
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
