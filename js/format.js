const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDay(date) {
  const d = new Date(date + "T00:00:00Z");
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}
export function fmtLong(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) return "";
  const d = new Date(date + "T00:00:00Z");
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function greeting(hour) {
  return hour < 12 ? "Good morning," : hour < 17 ? "Good afternoon," : "Good evening,";
}
