export const USERS = [
  { id: 'anna', name: 'Anna', keywords: ['anna'], bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-700', dot: 'bg-pink-400' },
  { id: 'simeon', name: 'Simeon', keywords: ['simeon'], bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', dot: 'bg-blue-400' },
  { id: 'tennille', name: 'Tennille', keywords: ['tennille'], bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-400' },
  { id: 'bibi', name: 'Bibi', keywords: ['bibi'], bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', dot: 'bg-purple-400' },
];

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_SHORT = ['J', 'F', 'M', 'A', 'M', 'June', 'J', 'A', 'S', 'O', 'N', 'D'];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const SYNC_INTERVAL_MS = 15 * 60 * 1000;

export const state = {
  view: 'week',
  selectedDate: startOfDay(new Date()),
  selectedMonth: new Date().getMonth(),
  selectedYear: new Date().getFullYear(),
  filteredUser: null,
  weekStartDate: startOfDay(new Date()),
  anchoredFromMonth: false,
  sidebarOpen: false,
  sidebarPinned: false,
};

let events = [];

export function getEvents() {
  return events;
}

export function setEvents(nextEvents) {
  events = Array.isArray(nextEvents) ? nextEvents : [];
}

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return startOfDay(x);
}

export function formatTimeReadable(d) {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return m === 0 ? `${h}:00` : `${h}:${String(m).padStart(2, '0')}`;
}

export function getRollingDays(startDate) {
  return Array.from({ length: 7 }, (_, i) => addDays(startDate, i));
}

export function getMondayOfWeek(d) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(x, diff);
}
