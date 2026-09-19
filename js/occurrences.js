export function isScheduledOn(task, dateISO, weekdayIndex) {
  if (task.recurrence.type === 'once') return task.recurrence.date === dateISO;
  return task.recurrence.days.includes(weekdayIndex);
}

function timesForTask(task) {
  return Array.isArray(task.timeOfDay) ? task.timeOfDay : [task.timeOfDay];
}

// Combines tasks + that date's exceptions + that date's completions into the
// list that should actually render for the given day. Skips are dropped,
// overrides are applied, and each item carries whether it's checked off.
export function buildListForDate(tasks, exceptions, completions, date, weekday) {
  const exceptionByTask = new Map(exceptions.filter((e) => e.date === date).map((e) => [e.taskId, e]));
  const completedTaskIds = new Set(completions.filter((c) => c.date === date).map((c) => c.taskId));

  const items = [];
  for (const task of tasks) {
    if (!isScheduledOn(task, date, weekday)) continue;
    const exception = exceptionByTask.get(task.id);
    if (exception && exception.type === 'skip') continue;

    const effective = exception && exception.type === 'override'
      ? { ...task, ...exception.overrides }
      : task;

    items.push({
      task: effective,
      sourceTask: task,
      date,
      completed: completedTaskIds.has(task.id),
      hasOverride: !!(exception && exception.type === 'override'),
    });
  }

  const bucketOrder = { morning: 0, afternoon: 1, evening: 2 };
  items.sort((a, b) => {
    const bucketDiff = Math.min(...timesForTask(a.task).map((time) => bucketOrder[time]))
      - Math.min(...timesForTask(b.task).map((time) => bucketOrder[time]));
    if (bucketDiff !== 0) return bucketDiff;
    // Manually reordered tasks carry an explicit `order`; anything from
    // before that feature (or never touched since) falls back to creation
    // order so it doesn't jump around once a sibling gets a real value.
    const a0 = a.task.order ?? a.task.createdAt ?? 0;
    const b0 = b.task.order ?? b.task.createdAt ?? 0;
    return a0 - b0;
  });
  return items;
}

export function groupByTimeOfDay(items) {
  return {
    morning: items.filter((i) => timesForTask(i.task).includes('morning')),
    afternoon: items.filter((i) => timesForTask(i.task).includes('afternoon')),
    evening: items.filter((i) => timesForTask(i.task).includes('evening')),
  };
}
