export const money = value => value == null || !Number.isFinite(value) ? 'Not established' : new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', maximumFractionDigits:2}).format(value / 100);
export function moneyRange(min,max){if(min==null||max==null)return 'Not established';return min===max?money(min):`${money(min)}–${money(max)}`}
export const dateTime = value => value ? new Date(value).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'Not recorded';
export function workspaceSavedLabel(record, cases) {
 const saved = `Saved ${dateTime(record.updatedAt)}`;
 const peers = cases.filter(other => other.title === record.title && dateTime(other.updatedAt) === dateTime(record.updatedAt));
 if (peers.length < 2) return saved;
 let length = 6;
 while (length < record.id.length && peers.some(other => other.id !== record.id && other.id.slice(0, length) === record.id.slice(0, length))) length += 2;
 return `${saved} · workspace ${record.id.slice(0, length).toUpperCase()}`;
}
export const words = value => String(value||'unknown').replaceAll('_',' ');
export const centsInput = value => value == null ? '' : (value/100).toFixed(2);
export const dollarsToCents = value => value.trim()===''?null:Math.round(Number(value)*100);
