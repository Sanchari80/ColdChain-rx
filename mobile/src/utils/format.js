export function minutesUntil(iso) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.round(diff / 60000);
}

export function etaLabel(iso) {
  const minutes = minutesUntil(iso);
  if (minutes === null) return 'No ETA';
  if (minutes <= 0) return 'Due now';
  if (minutes === 1) return 'In 1 minute';
  if (minutes < 60) return `In ${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  return `In ${hours}h ${minutes % 60}m`;
}

export function clockTime(iso) {
  if (!iso) return '--:--';
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function relativeTime(iso) {
  if (!iso) return '';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 90) return 'a minute ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function shortDrug(name, limit = 38) {
  if (!name) return 'Unnamed product';
  return name.length > limit ? `${name.slice(0, limit - 1).trimEnd()}...` : name;
}

/** Splits a long product name into the molecule and the rest of the description. */
export function drugParts(name) {
  if (!name) return { head: 'Unnamed product', tail: '' };
  const match = /^([A-Za-z\- ]+?)\s(\d.*)$/.exec(name);
  if (!match) return { head: name, tail: '' };
  return { head: match[1].trim(), tail: match[2].trim() };
}

export function celsius(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '--';
  return `${Number(value).toFixed(digits)}\u00B0C`;
}
