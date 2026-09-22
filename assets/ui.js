export const $ = id => document.getElementById(id);
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
export function icons() { window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } }); }
export const icon = name => '<i data-lucide="' + escapeHtml(name) + '"></i>';
export function message(id, text = '', kind = 'error') {
  const element = $(id);
  element.textContent = text; element.className = 'message ' + kind; element.hidden = !text;
}
export function busy(form, active) {
  form.setAttribute('aria-busy', String(active));
  for (const element of form.querySelectorAll('button, input, select, textarea')) {
    if (active) { element.dataset.wasDisabled = String(element.disabled); element.disabled = true; }
    else { element.disabled = element.dataset.wasDisabled === 'true'; delete element.dataset.wasDisabled; }
  }
}
let toastTimer;
export function toast(text) {
  $('toast').textContent = text; $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000);
}
export function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0,2).map(word => word[0] || '').join('').toUpperCase(); }
export function empty(title, text, action = '') {
  return '<div class="empty">' + icon('shield-check') + '<h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(text) + '</p>' + action + '</div>';
}
export function loading() { return '<div class="loading" role="status"><span class="spinner"></span>Loading your family space...</div>'; }
export function dateLabel(value, time = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  return date.toLocaleString(undefined, time ? {hour:'numeric',minute:'2-digit'} : {month:'long',day:'numeric',year:'numeric'});
}
export function errorText(error, fallback) {
  if (error?.code === '42703' || error?.code === 'PGRST204') return 'Some profile fields are not available yet. Please contact support so we can finish setting up your account.';
  if (error?.status === 401 || error?.code === 'PGRST301') return 'Your session has expired. Please sign out and sign in again.';
  return fallback;
}
