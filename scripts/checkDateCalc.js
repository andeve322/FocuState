function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const daysSinceSaturday = (d.getDay() + 1) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysSinceSaturday);
  return d;
}

function getMonthStart(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

function sumFocusMinutesSince(records, startDate) {
  if (!records) return 0;
  const startMs = startDate.getTime();
  return Object.entries(records).reduce((acc, [dateKey, minutes]) => {
    const parsed = new Date(`${dateKey}T00:00:00`);
    if (!isNaN(parsed.getTime()) && parsed.getTime() >= startMs) {
      acc += Number(minutes) || 0;
    }
    return acc;
  }, 0);
}

const now = new Date();
console.log('Today:', now.toISOString(), '(' + now.toDateString() + ')');
console.log('Day of week:', now.getDay(), '(0=Sun, 6=Sat)');

const weekStart = getWeekStart();
console.log('\nWeek start:', weekStart.toISOString(), '(' + weekStart.toDateString() + ')');

const monthStart = getMonthStart();
console.log('Month start:', monthStart.toISOString(), '(' + monthStart.toDateString() + ')');

const records = {
  '2025-12-08': 10,
  '2025-12-09': 0,
  '2025-12-10': 0,
  '2025-12-11': 150
};

const weeklyMinutes = sumFocusMinutesSince(records, weekStart);
const monthlyMinutes = sumFocusMinutesSince(records, monthStart);

console.log('\nRecords:', records);
console.log('Weekly minutes from', weekStart.toDateString() + ':', weeklyMinutes);
console.log('Monthly minutes from', monthStart.toDateString() + ':', monthlyMinutes);

// Check each record
console.log('\nDetailed check:');
Object.entries(records).forEach(([dateKey, minutes]) => {
  const parsed = new Date(`${dateKey}T00:00:00`);
  const isInWeek = parsed.getTime() >= weekStart.getTime();
  const isInMonth = parsed.getTime() >= monthStart.getTime();
  console.log(`${dateKey}: ${minutes} min - in week: ${isInWeek}, in month: ${isInMonth}`);
});
