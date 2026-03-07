export function fmtNum(v, decimals = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toFixed(decimals);
}

export function fmtKWh(v) {
  if (v == null || isNaN(v)) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)} MWh`;
  return `${n.toFixed(2)} kWh`;
}

export function fmtPrice(v) {
  if (v == null || isNaN(v)) return '—';
  return `$${Number(v).toFixed(4)}`;
}

export function fmtTemp(v) {
  if (v == null || isNaN(v)) return '—';
  return `${Number(v).toFixed(1)}°C`;
}

export function fmtPct(v) {
  if (v == null || isNaN(v)) return '—';
  return `${(Number(v) * 100).toFixed(1)}%`;
}

export function fmtTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const hh = String(d.getHours()).padStart(2, '0');
  return `${months[d.getMonth()]} ${d.getDate()} ${hh}:00`;
}

export function fmtTimestampShort(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:00`;
}

export function parseHour(ts) {
  if (!ts) return 0;
  return parseInt(ts.split('T')[1]?.split(':')[0] || '0', 10);
}

export function kpiLabel(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\btotal\b/gi, '')
    .replace(/\baverage\b/gi, 'avg')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

export function kpiColor(value) {
  const v = parseFloat(value);
  if (isNaN(v)) return 'text-slate-400';
  if (v < 0.7) return 'text-emerald-600';
  if (v <= 1.0) return 'text-amber-600';
  return 'text-red-600';
}

export function kpiBg(value) {
  const v = parseFloat(value);
  if (isNaN(v)) return 'bg-slate-50';
  if (v < 0.7) return 'bg-emerald-50';
  if (v <= 1.0) return 'bg-amber-50';
  return 'bg-red-50';
}

export function sum(arr, start = 0, end) {
  const s = arr.slice(start, end);
  return s.reduce((a, b) => a + (Number(b) || 0), 0);
}
