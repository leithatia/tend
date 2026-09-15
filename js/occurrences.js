export function isScheduledOn(task, dateISO, weekdayIndex) {
  if (task.recurrence.type === 'once') return task.recurrence.date === dateISO;
  return task.recurrence.days.includes(weekdayIndex);
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

  const order = { morning: 0, afternoon: 1, evening: 2 };
  items.sort((a, b) => order[a.task.timeOfDay] - order[b.task.timeOfDay]);
  return items;
}

export function groupByTimeOfDay(items) {
  return {
    morning: items.filter((i) => i.task.timeOfDay === 'morning'),
    afternoon: items.filter((i) => i.task.timeOfDay === 'afternoon'),
    evening: items.filter((i) => i.task.timeOfDay === 'evening'),
  };
}
