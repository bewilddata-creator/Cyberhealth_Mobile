export function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
export function telHref(phone) {
  const digits = String(phone || "").trim().replace(/(?!^\+)[^\d]/g, "");
  return /\d/.test(digits) ? `tel:${digits}` : "";
}
