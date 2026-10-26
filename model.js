export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function monthCells(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const count = new Date(date.getFullYear(), date.getMonth()+1, 0).getDate();
  return [...Array((first.getDay()+6)%7).fill(null), ...Array.from({length:count}, (_, i) => dateKey(new Date(date.getFullYear(), date.getMonth(), i+1)))];
}
export function remainingSeconds(deadline, now) { return Math.max(0, Math.ceil((deadline-now)/1000)); }
