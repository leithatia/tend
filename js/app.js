import { Tasks, Exceptions, Completions, deleteTaskCascade, pruneOldData } from './db.js';
import { buildListForDate, groupByTimeOfDay } from './occurrences.js';
import {
  todayISO, todayWeekdayIndex, getWeekDates, weekdayIndexForDate,
  WEEKDAY_NAMES, WEEKDAY_LABELS, formatMonthDay,
} from './date.js';
import { emojiForCategory, tintForCategory } from './categories.js';
import { ICONS } from './icons.js';
import { initTaskForm, openTaskFormForAdd, openTaskFormForEdit, isTaskFormOpen } from './taskForm.js';
import { initActionSheet, openActionSheet, openDeleteConfirmForItem } from './actionSheet.js';
import { downloadExport, importFromFile, getLastExportAt } from './backup.js';

const appRoot = document.getElementById('app');
const listContainer = document.getElementById('listContainer');
const dayHeading = document.getElementById('dayHeading');
const dateSub = document.getElementById('dateSub');
const dayStrip = document.getElementById('dayStrip');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');
const toastUndoBtn = document.getElementById('toastUndoBtn');
let toastTimer = null;

let selectedWeekday = todayWeekdayIndex();
let selectedDate = todayISO();

function dayPhrase(dateISO) {
  return dateISO === todayISO() ? 'today' : WEEKDAY_NAMES[weekdayIndexForDate(dateISO)];
}

function showToast(message, undoFn) {
  toastMessage.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastUndoBtn.hidden = !undoFn;
  toastUndoBtn.onclick = undoFn
    ? () => {
      clearTimeout(toastTimer);
      toast.hidden = true;
      undoFn();
    }
    : null;
  toastTimer = setTimeout(() => { toast.hidden = true; }, undoFn ? 5000 : 2200);
}

const SECTION_META = {
  morning: { label: 'Morning', icon: ICONS.sun },
  afternoon: { label: 'Afternoon', icon: ICONS.cloud },
  evening: { label: 'Evening', icon: ICONS.moon },
};

// Tasks/exceptions/completions are cached in memory so the live swipe drag
// can synchronously build a preview of an adjacent day without hitting
// IndexedDB on every touchmove frame.
let cachedTasks = [];
let cachedExceptions = [];
let cachedCompletions = [];

async function loadData() {
  [cachedTasks, cachedExceptions, cachedCompletions] = await Promise.all([
    Tasks.getAll(),
    Exceptions.getAll(),
    Completions.getAll(),
  ]);
}

function itemsForDate(dateISO, weekdayIdx) {
  return buildListForDate(cachedTasks, cachedExceptions, cachedCompletions, dateISO, weekdayIdx);
}

async function refresh(direction) {
  await loadData();
  const items = itemsForDate(selectedDate, selectedWeekday);
  if (direction) {
    animateSwap(items, direction);
  } else {
    render(items);
  }
}

// Simple slide+fade crossfade so switching days reads like turning a page,
// rather than the list just instantly changing underneath you.
function animateSwap(items, direction) {
  const outClass = direction === 'forward' ? 'slide-out-left' : 'slide-out-right';
  const inClass = direction === 'forward' ? 'slide-in-right' : 'slide-in-left';
  let done = false;

  function finish() {
    if (done) return;
    done = true;
    listContainer.removeEventListener('transitionend', finish);
    clearTimeout(fallback);
    render(items);
    listContainer.classList.remove(outClass);
    listContainer.classList.add('no-anim', inClass);
    void listContainer.offsetWidth; // force reflow so the next class removal animates
    listContainer.classList.remove('no-anim');
    requestAnimationFrame(() => {
      listContainer.classList.remove(inClass);
    });
  }

  const fallback = setTimeout(finish, 200);
  listContainer.addEventListener('transitionend', finish, { once: true });
  listContainer.classList.add(outClass);
}

// Only one row's swipe actions are revealed at a time; this closes whichever
// one is currently open. Reset whenever the list is rebuilt.
let closeOpenRow = null;

// The currently-rendered day's items, grouped by time of day — kept around
// so an in-progress long-press reorder can look up "what else is in this
// section" without re-querying the DOM for task data. Rebuilt on every
// render(); stale during a drag, which is fine since nothing else can write
// to the list mid-gesture.
let currentGroups = null;

// Builds the task-list markup for a given day into a fragment, independent
// of whichever container it ends up in — used both for the real listContainer
// and for the transient preview panel during a swipe drag.
function buildDayContent(items, dateISO, weekdayIdx) {
  const frag = document.createDocumentFragment();

  if (items.length === 0) {
    currentGroups = null;
    const isToday = dateISO === todayISO();
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = isToday
      ? 'Nothing on the list for today. Tap + to add a task.'
      : `Nothing on ${WEEKDAY_NAMES[weekdayIdx]}'s list. Tap + to add a task.`;
    frag.appendChild(empty);
    return frag;
  }

  const groups = groupByTimeOfDay(items);
  currentGroups = groups;
  // All three sections always render, even ones with nothing scheduled —
  // so a long-press drag never has to change the page layout to make room
  // for a drop target, which used to shove the dragged row away from
  // wherever the finger actually was the moment the drag started.
  for (const key of ['morning', 'afternoon', 'evening']) {
    const section = document.createElement('section');
    section.className = 'section';
    section.dataset.timeKey = key;

    const title = document.createElement('p');
    title.className = 'section-title';
    title.innerHTML = `${SECTION_META[key].icon}${SECTION_META[key].label}`;
    section.appendChild(title);

    const list = document.createElement('div');
    list.className = 'task-list';
    groups[key].forEach((item) => list.appendChild(renderTaskRow(item, key)));
    section.appendChild(list);

    frag.appendChild(section);
  }
  return frag;
}

function render(items) {
  listContainer.innerHTML = '';
  closeOpenRow = null;
  listContainer.appendChild(buildDayContent(items, selectedDate, selectedWeekday));
}

const ROW_REVEAL = 128; // two 64px action buttons

// ---------- Long-press drag reorder ----------
// Long-pressing a row picks it up; dragging vertically tracks the finger
// (compensating for auto-scroll so it doesn't drift). Every other row in
// the day — including the empty-section placeholders — has its document-
// relative position captured once at drag start; as the dragged row passes
// each one, it slides aside (a plain CSS transition) to open a gap, which
// the dragged row (tracking the finger) visually fills. Dropping onto a
// different time-of-day section moves the task there for good, same as
// changing its time of day in the edit form would.
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE = 10;
const AUTO_SCROLL_EDGE = 70;
const AUTO_SCROLL_STEP = 10;

let reorderState = null;
let reorderRafId = null;
// Click handlers on checkbox/label/actions check this so the synthetic
// `click` a touch drag leaves behind doesn't also toggle/open whatever
// happens to be under the finger when it lands.
let suppressClickUntil = 0;

function sectionItems(key) {
  return currentGroups ? currentGroups[key] : [];
}

// The dragged row's own spot in the flow is held open by an invisible
// spacer (not the "Drop here" box from before — no visible element at all)
// while the row itself becomes position:fixed and just follows the finger.
// Moving the spacer through the real DOM as the target changes means the
// browser's own layout does the work of opening/closing gaps — rows below
// it, and section headers past the boundary it crosses, all reflow for
// free, with no separate shifting logic needed to keep them in sync.
function buildSpacer(height) {
  const el = document.createElement('div');
  el.className = 'reorder-spacer';
  el.style.height = `${height}px`;
  return el;
}

// Every other row's current center, freshly measured (cheap for a short
// list, and necessary since the spacer's position — and therefore
// everyone below it — changes as the drag progresses). A section with no
// rows of its own (once the dragged one and the spacer are excluded) is
// still represented by its empty .task-list, so dropping into an empty
// time of day works the same way as dropping next to any other row.
function collectLiveSlots(wrap) {
  const slots = [];
  for (const key of ['morning', 'afternoon', 'evening']) {
    const section = listContainer.querySelector(`.section[data-time-key="${key}"]`);
    if (!section) continue;
    const list = section.querySelector('.task-list');
    const rows = [...list.querySelectorAll('.task-row-wrap')].filter((el) => el !== wrap);
    if (rows.length === 0) {
      const rect = list.getBoundingClientRect();
      slots.push({ sectionKey: key, isEmpty: true, center: rect.top + rect.height / 2 });
    } else {
      rows.forEach((el) => {
        const rect = el.getBoundingClientRect();
        slots.push({ sectionKey: key, isEmpty: false, el, center: rect.top + rect.height / 2 });
      });
    }
  }
  return slots;
}

function resolveLiveTarget(wrap, centerY) {
  const slots = collectLiveSlots(wrap);
  if (slots.length === 0) return { sectionKey: null, index: 0 };
  let best = slots[0];
  let bestDist = Infinity;
  for (const slot of slots) {
    const dist = Math.abs(centerY - slot.center);
    if (dist < bestDist) { bestDist = dist; best = slot; }
  }
  if (best.isEmpty) return { sectionKey: best.sectionKey, index: 0 };
  const after = centerY > best.center;
  const sameSection = slots.filter((s) => s.sectionKey === best.sectionKey && !s.isEmpty);
  const index = sameSection.indexOf(best) + (after ? 1 : 0);
  return { sectionKey: best.sectionKey, index };
}

function spacerRefEl(target) {
  const section = listContainer.querySelector(`.section[data-time-key="${target.sectionKey}"] .task-list`);
  const rows = [...section.querySelectorAll('.task-row-wrap')].filter((el) => el !== reorderState.wrap);
  return { section, refEl: rows[target.index] || null };
}

// FLIP: measure every row/header before the spacer moves, move it (an
// instant, unanimated DOM reflow), then measure again and animate each
// element that actually shifted from its old position to its new one.
function flipTargets() {
  return [...listContainer.querySelectorAll('.task-row-wrap:not(.reorder-lifted), .section-title')];
}

function moveSpacerWithFlip(target) {
  const els = flipTargets();
  const before = new Map(els.map((el) => [el, el.getBoundingClientRect().top]));

  const { section, refEl } = spacerRefEl(target);
  if (refEl) section.insertBefore(reorderState.spacer, refEl);
  else section.appendChild(reorderState.spacer);

  flipTargets().forEach((el) => {
    const prevTop = before.get(el);
    if (prevTop === undefined) return;
    const delta = prevTop - el.getBoundingClientRect().top;
    if (Math.abs(delta) < 0.5) return;
    el.style.transition = 'none';
    el.style.transform = `translateY(${delta}px)`;
    void el.offsetHeight; // force the inverted position to commit before animating away from it
    requestAnimationFrame(() => {
      el.style.transition = 'transform 150ms ease';
      el.style.transform = '';
    });
  });
}

function stopReorderVisuals() {
  if (reorderRafId) cancelAnimationFrame(reorderRafId);
  reorderRafId = null;
  if (reorderState) {
    const { wrap, spacer } = reorderState;
    wrap.style.position = '';
    wrap.style.top = '';
    wrap.style.left = '';
    wrap.style.width = '';
    wrap.style.margin = '';
    wrap.style.touchAction = '';
    wrap.classList.remove('reorder-lifted');
    if (spacer.parentNode) spacer.remove();
  }
  listContainer.classList.remove('reordering');
}

function reorderTick() {
  if (!reorderState) return;
  const s = reorderState;
  const vh = window.innerHeight;
  if (s.lastClientY < AUTO_SCROLL_EDGE) window.scrollBy(0, -AUTO_SCROLL_STEP);
  else if (s.lastClientY > vh - AUTO_SCROLL_EDGE) window.scrollBy(0, AUTO_SCROLL_STEP);

  const top = s.lastClientY - s.grabOffsetY;
  s.wrap.style.top = `${top}px`;

  const target = resolveLiveTarget(s.wrap, top + s.height / 2);
  if (target.sectionKey
    && (target.sectionKey !== s.currentTarget.sectionKey || target.index !== s.currentTarget.index)) {
    moveSpacerWithFlip(target);
    s.currentTarget = target;
  }

  reorderRafId = requestAnimationFrame(reorderTick);
}

// A task can now be scheduled for more than one time of day, so dragging
// one of its rows into a different section doesn't replace its whole
// schedule — it swaps just that one membership (the section dragged out of,
// for the section dragged into), leaving any other times untouched.
function nextTimesForDrag(sourceTask, fromKey, toKey) {
  const times = Array.isArray(sourceTask.timeOfDay) ? sourceTask.timeOfDay : [sourceTask.timeOfDay];
  if (fromKey === toKey) return times;
  const set = new Set(times);
  set.delete(fromKey);
  set.add(toKey);
  return ['morning', 'afternoon', 'evening'].filter((t) => set.has(t));
}

async function commitReorder(item, fromKey, target) {
  const sourceTask = item.sourceTask;
  const targetKey = target.sectionKey;
  const draggedTask = { ...sourceTask, timeOfDay: nextTimesForDrag(sourceTask, fromKey, targetKey) };

  const currentItems = sectionItems(targetKey)
    .filter((i) => i.sourceTask.id !== sourceTask.id)
    .map((i) => i.sourceTask);
  const insertAt = Math.max(0, Math.min(currentItems.length, target.index));
  currentItems.splice(insertAt, 0, draggedTask);
  await Promise.all(currentItems.map((t, i) => Tasks.put({ ...t, order: i })));
  await refresh();
}

function startReorder(wrap, item, sectionKey, y) {
  if (isTaskFormOpen() || reorderState) return;
  if (closeOpenRow) { closeOpenRow(); closeOpenRow = null; }
  if (navigator.vibrate) navigator.vibrate(12);

  listContainer.classList.add('reordering');

  const rect = wrap.getBoundingClientRect();
  const spacer = buildSpacer(rect.height);
  wrap.parentNode.insertBefore(spacer, wrap);

  wrap.style.position = 'fixed';
  wrap.style.top = `${rect.top}px`;
  wrap.style.left = `${rect.left}px`;
  wrap.style.width = `${rect.width}px`;
  wrap.style.margin = '0';
  wrap.style.touchAction = 'none';
  wrap.classList.add('reorder-lifted');

  const startTarget = resolveLiveTarget(wrap, rect.top + rect.height / 2);
  reorderState = {
    wrap,
    item,
    spacer,
    originalSectionKey: sectionKey,
    grabOffsetY: y - rect.top,
    height: rect.height,
    lastClientY: y,
    currentTarget: startTarget,
    originalTarget: startTarget,
  };
  reorderRafId = requestAnimationFrame(reorderTick);
}

function updateReorder(y) {
  if (!reorderState) return;
  reorderState.lastClientY = y;
}

async function finishReorder(y) {
  if (!reorderState) return;
  reorderState.lastClientY = y;
  const state = reorderState;
  const target = state.currentTarget;
  stopReorderVisuals();
  reorderState = null;
  suppressClickUntil = Date.now() + 500;

  const noop = !target.sectionKey
    || (target.sectionKey === state.originalTarget.sectionKey && target.index === state.originalTarget.index);
  if (noop) return;
  await commitReorder(state.item, state.originalSectionKey, target);
}

function cancelReorder() {
  if (!reorderState) return;
  stopReorderVisuals();
  reorderState = null;
  suppressClickUntil = Date.now() + 500;
}

function renderTaskRow(item, sectionKey) {
  const wrap = document.createElement('div');
  wrap.className = 'task-row-wrap';
  wrap.dataset.taskId = item.sourceTask.id;

  const actions = document.createElement('div');
  actions.className = 'task-row-actions';

  const editAction = document.createElement('button');
  editAction.type = 'button';
  editAction.className = 'row-action edit';
  editAction.setAttribute('aria-label', 'Edit task');
  editAction.innerHTML = ICONS.edit;

  const deleteAction = document.createElement('button');
  deleteAction.type = 'button';
  deleteAction.className = 'row-action delete';
  deleteAction.setAttribute('aria-label', 'Delete task');
  deleteAction.innerHTML = ICONS.trash;

  actions.appendChild(editAction);
  actions.appendChild(deleteAction);

  const row = document.createElement('div');
  row.className = 'task-row' + (item.completed ? ' completed' : '');

  const checkbox = document.createElement('button');
  checkbox.type = 'button';
  checkbox.className = 'task-checkbox';
  checkbox.setAttribute('aria-label', item.completed ? 'Mark not done' : 'Mark done');
  checkbox.innerHTML = ICONS.check;

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

  const tag = document.createElement('span');
  tag.className = `tag tag-${tintForCategory(item.task.category)}`;
  tag.textContent = `${emojiForCategory(item.task.category)} ${item.task.category}`;

  row.appendChild(checkbox);
  row.appendChild(labelBtn);
  row.appendChild(tag);
  wrap.appendChild(actions);
  wrap.appendChild(row);

  // ----- swipe-to-reveal (edit / delete) + long-press drag reorder -----
  let isOpen = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let longPressTimer = null;
  let longPressCancelled = false;

  function setX(x, animate) {
    wrap.classList.toggle('dragging', !animate);
    row.style.transform = x === 0 ? '' : `translateX(${x}px)`;
  }

  function close() {
    isOpen = false;
    setX(0, true);
  }

  wrap.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    baseX = isOpen ? -ROW_REVEAL : 0;
    dragging = false;

    clearTimeout(longPressTimer);
    longPressCancelled = false;
    if (!isOpen) {
      longPressTimer = setTimeout(() => {
        if (!longPressCancelled) startReorder(wrap, item, sectionKey, t.clientY);
      }, LONG_PRESS_MS);
    }
  }, { passive: true });

  wrap.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (reorderState && reorderState.wrap === wrap) {
      // touch-action:none (set when the drag started) is only reliably
      // honored by some browsers for gestures that begin *after* it's set —
      // since this same touch sequence started before that, the browser can
      // still try to scroll the page underneath the drag unless explicitly
      // told not to on every move.
      e.preventDefault();
      updateReorder(t.clientY);
      return;
    }
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (!longPressCancelled
      && (Math.abs(dx) > LONG_PRESS_MOVE_TOLERANCE || Math.abs(dy) > LONG_PRESS_MOVE_TOLERANCE)) {
      longPressCancelled = true;
      clearTimeout(longPressTimer);
    }
    if (!dragging) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
      dragging = true;
      if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
      closeOpenRow = close;
    }
    const x = Math.min(0, Math.max(-ROW_REVEAL, baseX + dx));
    setX(x, false);
  }, { passive: false });

  wrap.addEventListener('touchend', (e) => {
    clearTimeout(longPressTimer);
    const t = e.changedTouches[0];
    if (reorderState && reorderState.wrap === wrap) {
      finishReorder(t.clientY);
      return;
    }
    if (!dragging) return;
    dragging = false;
    const dx = t.clientX - startX;
    isOpen = (baseX + dx) < -ROW_REVEAL / 2;
    setX(isOpen ? -ROW_REVEAL : 0, true);
    if (isOpen) closeOpenRow = close;
  }, { passive: true });

  wrap.addEventListener('touchcancel', () => {
    clearTimeout(longPressTimer);
    if (reorderState && reorderState.wrap === wrap) cancelReorder();
  }, { passive: true });

  checkbox.addEventListener('click', () => {
    if (Date.now() < suppressClickUntil) return;
    if (isOpen) { close(); return; }
    toggleCompletion(item);
  });

  labelBtn.addEventListener('click', () => {
    if (Date.now() < suppressClickUntil) return;
    if (isOpen) { close(); return; }
    openActionSheet(item);
  });

  editAction.addEventListener('click', () => {
    close();
    startEdit(item);
  });

  deleteAction.addEventListener('click', () => {
    close();
    openDeleteConfirmForItem(item);
  });

  return wrap;
}

function startEdit(item) {
  openTaskFormForEdit(item.sourceTask, (formData) => handleEditSubmit(item, formData));
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
  const direction = idx > selectedWeekday ? 'forward' : 'backward';
  selectedWeekday = idx;
  selectedDate = getWeekDates()[idx];
  updateHeader();
  renderDayStrip();
  refresh(direction);
}

// ---------- Live swipe-driven day pager ----------
// Dragging over the day strip or the page background (not a task row) tracks
// the finger 1:1: the current day's panel slides out while the
// next/previous day's panel slides in right behind your finger, like a page
// being turned. Releasing past ~35% of the width commits the day change;
// releasing short of that snaps back. Clamped to the current week.
let pager = null;
let dragStartX = 0;
let dragStartY = 0;
let dragMode = null; // null | 'row' | 'pager' | 'blocked'
const PAGE_GAP = 16; // visible breathing room between the two panels while dragging

function startPagerDrag(dir) {
  const previewIdx = selectedWeekday + (dir === 'forward' ? 1 : -1);
  if (previewIdx < 0 || previewIdx > 6) return null;

  const width = listContainer.clientWidth;
  const height = listContainer.getBoundingClientRect().height;
  const previewDate = getWeekDates()[previewIdx];
  const previewItems = itemsForDate(previewDate, previewIdx);

  const currentEl = document.createElement('div');
  currentEl.className = 'day-panel';
  currentEl.innerHTML = listContainer.innerHTML;

  const previewEl = document.createElement('div');
  previewEl.className = 'day-panel';
  previewEl.appendChild(buildDayContent(previewItems, previewDate, previewIdx));

  // Offset by width + a fixed gap, so the gap stays constant (not growing or
  // shrinking) as both panels travel together during the drag.
  const offset = dir === 'forward' ? width + PAGE_GAP : -(width + PAGE_GAP);
  previewEl.style.transform = `translateX(${offset}px)`;

  listContainer.style.height = `${height}px`;
  listContainer.innerHTML = '';
  listContainer.appendChild(currentEl);
  listContainer.appendChild(previewEl);

  return {
    dir, previewIdx, previewDate, previewItems, width, offset, currentEl, previewEl, lastDx: 0,
  };
}

function updatePagerDrag(dx) {
  const clamped = Math.max(-pager.width, Math.min(pager.width, dx));
  pager.currentEl.style.transform = `translateX(${clamped}px)`;
  pager.previewEl.style.transform = `translateX(${pager.offset + clamped}px)`;
  pager.lastDx = clamped;
}

function settlePagerDrag(commit) {
  const { currentEl, previewEl, width, offset } = pager;
  let done = false;

  function finish() {
    if (done) return;
    done = true;
    currentEl.removeEventListener('transitionend', finish);
    clearTimeout(fallback);
    if (commit) {
      selectedWeekday = pager.previewIdx;
      selectedDate = pager.previewDate;
      updateHeader();
      renderDayStrip();
      render(pager.previewItems);
    } else {
      render(itemsForDate(selectedDate, selectedWeekday));
    }
    listContainer.style.height = '';
    pager = null;
  }

  const fallback = setTimeout(finish, 220);
  currentEl.addEventListener('transitionend', finish, { once: true });
  currentEl.style.transition = 'transform 160ms ease';
  previewEl.style.transition = 'transform 160ms ease';

  if (commit) {
    currentEl.style.transform = `translateX(${offset > 0 ? -width : width}px)`;
    previewEl.style.transform = 'translateX(0)';
  } else {
    currentEl.style.transform = 'translateX(0)';
    previewEl.style.transform = `translateX(${offset}px)`;
  }
}

appRoot.addEventListener('touchstart', (e) => {
  dragMode = e.target.closest('.task-row-wrap') ? 'row' : null;
  const t = e.changedTouches[0];
  dragStartX = t.clientX;
  dragStartY = t.clientY;
}, { passive: true });

appRoot.addEventListener('touchmove', (e) => {
  if (dragMode === 'row' || dragMode === 'blocked') return;
  const t = e.touches[0];
  const dx = t.clientX - dragStartX;
  const dy = t.clientY - dragStartY;

  if (dragMode === null) {
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
    pager = startPagerDrag(dx < 0 ? 'forward' : 'backward');
    dragMode = pager ? 'pager' : 'blocked';
    if (!pager) return;
  }

  updatePagerDrag(dx);
}, { passive: true });

const PAGER_COMMIT_RATIO = 0.18; // fraction of the width you need to drag before it commits

function endPagerDrag() {
  if (dragMode === 'pager' && pager) {
    settlePagerDrag(Math.abs(pager.lastDx) > pager.width * PAGER_COMMIT_RATIO);
  }
  dragMode = null;
}
appRoot.addEventListener('touchend', endPagerDrag, { passive: true });
appRoot.addEventListener('touchcancel', endPagerDrag, { passive: true });

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
      order: Date.now(),
    };
    await Tasks.put(task);
    await refresh();
    showToast('Task added.');
  }, selectedWeekday);
});

// ---------- Edit / delete (via action sheet) ----------
initActionSheet({
  onEdit: startEdit,
  onDeleteOnce: async (item) => {
    const taskId = item.sourceTask.id;
    const { date } = item;
    await Exceptions.put({ taskId, date, type: 'skip' });
    await refresh();
    showToast(`Removed for ${dayPhrase(date)}.`, async () => {
      await Exceptions.delete(taskId, date);
      await refresh();
    });
  },
  onDeleteAll: async (item) => {
    const taskId = item.sourceTask.id;
    const taskSnapshot = item.sourceTask;
    const [exceptionsSnapshot, completionsSnapshot] = await Promise.all([
      Exceptions.getForTask(taskId),
      Completions.getForTask(taskId),
    ]);
    await deleteTaskCascade(taskId);
    await refresh();
    showToast('Task deleted.', async () => {
      await Tasks.put(taskSnapshot);
      await Promise.all([
        ...exceptionsSnapshot.map((e) => Exceptions.put(e)),
        ...completionsSnapshot.map((c) => Completions.put(c)),
      ]);
      await refresh();
    });
  },
});

function sameRecurrence(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'once') return a.date === b.date;
  return a.days.length === b.days.length && a.days.every((d, i) => d === b.days[i]);
}

function sameTimeOfDay(a, b) {
  const aTimes = Array.isArray(a) ? a : [a];
  const bTimes = Array.isArray(b) ? b : [b];
  return aTimes.length === bTimes.length && aTimes.every((time, i) => time === bTimes[i]);
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
    || !sameTimeOfDay(formData.timeOfDay, source.timeOfDay);

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
  if (!sameTimeOfDay(formData.timeOfDay, source.timeOfDay)) {
    overrides.timeOfDay = formData.timeOfDay;
  }
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

const themeToggleBtn = document.getElementById('themeToggleBtn');
function currentTheme() {
  const forced = document.documentElement.getAttribute('data-theme');
  if (forced === 'light' || forced === 'dark') return forced;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function renderThemeToggle() {
  const isLight = currentTheme() === 'light';
  themeToggleBtn.innerHTML = isLight
    ? `${ICONS.moon}<span>Switch to dark mode</span>`
    : `${ICONS.sun}<span>Switch to light mode</span>`;
  document.querySelector('meta[name="theme-color"]')
    .setAttribute('content', isLight ? '#f3ecda' : '#0f1a13');
}
themeToggleBtn.addEventListener('click', () => {
  const next = currentTheme() === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('dp_theme', next);
  renderThemeToggle();
});
renderThemeToggle();

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

// Gently nag about backing up if it's been a while — export/import is the
// only backup mechanism this app has, so silently losing the habit of doing
// it means silently risking losing everything.
const BACKUP_NUDGE_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days
function maybeShowBackupNudge() {
  if (cachedTasks.length === 0) return;
  const now = Date.now();
  let lastNudge = 0;
  try {
    lastNudge = Number(localStorage.getItem('dp_lastBackupNudgeAt') || 0);
  } catch {
    // ignore
  }
  if (now - getLastExportAt() < BACKUP_NUDGE_INTERVAL) return;
  if (now - lastNudge < BACKUP_NUDGE_INTERVAL) return;
  try {
    localStorage.setItem('dp_lastBackupNudgeAt', String(now));
  } catch {
    // ignore
  }
  showToast("Haven't backed up in a while — tap ⋯ to export.");
}

// ---------- Boot ----------
updateHeader();
renderDayStrip();
initTaskForm();
refresh().then(() => {
  maybeShowBackupNudge();
  // Sweep up one-off tasks (and exceptions/completions) from before this
  // week — the app can never navigate back to them, so they're just dead
  // weight. Runs after the first render so it never delays showing today.
  pruneOldData(getWeekDates()[0]).catch((err) => {
    console.error('Prune failed:', err);
  });
});

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
  // whatever was already loaded in memory. If the add/edit form is open,
  // wait until it's closed so in-progress typing isn't lost.
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    const tryReload = () => {
      if (isTaskFormOpen()) {
        setTimeout(tryReload, 1000);
      } else {
        window.location.reload();
      }
    };
    tryReload();
  });
}
