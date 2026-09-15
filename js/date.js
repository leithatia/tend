// All "today" resolution goes through this file so the whole app agrees on
// one timezone regardless of the device's own clock/timezone setting.
const TIME_ZONE = 'Asia/Ho_Chi_Minh';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getZonedParts(date = new Date()) {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(date).map((p) => [p.type, p.value])
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function toISODate({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function todayISO() {
  return toISODate(getZonedParts());
}

// 0 = Monday ... 6 = Sunday, matching the day-circle picker order in the mockups.
export function todayWeekdayIndex() {
  const { year, month, day } = getZonedParts();
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const jsDay = utcDate.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  return (jsDay + 6) % 7;
}

// Dates (YYYY-MM-DD) for the Monday..Sunday week containing "today".
export function getWeekDates() {
  const { year, month, day } = getZonedParts();
  const todayUTC = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (todayUTC.getUTCDay() + 6) % 7;
  const monday = new Date(todayUTC);
  monday.setUTCDate(todayUTC.getUTCDate() - mondayOffset);

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    dates.push(toISODate({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }));
  }
  return dates;
}

export const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function formatTodayHeading() {
  const idx = todayWeekdayIndex();
  const { day, month } = getZonedParts();
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${WEEKDAY_NAMES[idx]}, ${MONTHS[month - 1]} ${day}`;
}
