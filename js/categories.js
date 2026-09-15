// Categories are free-text (e.g. "pills", "gym — push day"); we derive a
// matching emoji and a consistent tint color rather than making the user
// manage a separate categories list.
const KEYWORD_EMOJI = [
  [/pill|medicine|vitamin|supplement/i, '💊'],
  [/gym|workout|lift|training|exercise/i, '🏋️'],
  [/meditat|mindful|breath/i, '🧘'],
  [/water|hydrat/i, '💧'],
  [/read/i, '📖'],
  [/walk|run|jog|cardio/i, '🏃'],
  [/sleep|bed/i, '😴'],
  [/journal|write|diary/i, '📓'],
  [/stretch|yoga/i, '🤸'],
  [/clean|chore|tidy|laundry/i, '🧹'],
  [/work|study|focus/i, '💼'],
  [/eat|meal|food|diet|cook/i, '🍽️'],
  [/call|family|friend/i, '📞'],
  [/pet|dog|cat/i, '🐾'],
];

const TINTS = ['blue', 'purple', 'green', 'orange', 'pink', 'gray'];

export function emojiForCategory(category) {
  const match = KEYWORD_EMOJI.find(([re]) => re.test(category));
  return match ? match[1] : '🔖';
}

export function tintForCategory(category) {
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  }
  return TINTS[hash % TINTS.length];
}
