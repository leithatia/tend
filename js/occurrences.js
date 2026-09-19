export function isScheduledOn(task, dateISO, weekdayIndex) {
  if (task.recurrence.type === 'once') return task.recurrence.date === dateISO;
  return task.recurrence.days.includes(weekdayIndex);
}

function timesForTask(task) {
  return Array.isArray(task.timeOfDay) ? task.timeOfDay : [task.timeOfDay];
}

// Combines tasks + that date's exceptions + that date's completions into the
// list that should actually render for the given day. Skips are dropped,
// overrides are applied, and each item carries which of its times of day
// are checked off — a task scheduled for more than one time of day can be
// done for morning without evening also counting as done, so completion is
// tracked per time rather than as a single flag for the whole task.
export function buildListForDate(tasks, exceptions, completions, date, weekday) {
  const exceptionByTask = new Map(exceptions.filter((e) => e.date === date).map((e) => [e.taskId, e]));
  const completionByTask = new Map(completions.filter((c) => c.date === date).map((c) => [c.taskId, c]));

  const items = [];
  for (const task of tasks) {
    if (!isScheduledOn(task, date, weekday)) continue;
    const exception = exceptionByTask.get(task.id);
    if (exception && exception.type === 'skip') continue;

    const effective = exception && exception.type === 'override'
      ? { ...task, ...exception.overrides }
      : task;

    const completion = completionByTask.get(task.id);
    // A completion saved before per-time tracking existed has no `times`
    // field — treat it as the whole task being done, matching what it
    // meant when it was written, rather than silently un-completing it.
    const completedTimes = completion
      ? new Set(completion.times ?? timesForTask(effective))
      : new Set();

    items.push({
      task: effective,
      sourceTask: task,
      date,
      completedTimes,
      hasOverride: !!(exception && exception.type === 'override'),
    });
  }

  return items;
}

// Manually reordered tasks carry an explicit `order`; anything from before
// that feature (or never touched since) falls back to creation order so it
// doesn't jump around once a sibling gets a real value. Sorting has to
// happen per time-of-day bucket, not once globally beforehand — a task
// scheduled for more than one time of day can hold a different position in
// each section it appears in, which a single shared sort can't represent
// (it'd always rank the task by whichever of its times comes earliest,
// regardless of where it actually belongs within a later section).
function sortBucket(items) {
  return [...items].sort((a, b) => {
    const a0 = a.task.order ?? a.task.createdAt ?? 0;
    const b0 = b.task.order ?? b.task.createdAt ?? 0;
    return a0 - b0;
  });
}

export function groupByTimeOfDay(items) {
  return {
    morning: sortBucket(items.filter((i) => timesForTask(i.task).includes('morning'))),
    afternoon: sortBucket(items.filter((i) => timesForTask(i.task).includes('afternoon'))),
    evening: sortBucket(items.filter((i) => timesForTask(i.task).includes('evening'))),
  };
}
