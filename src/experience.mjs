// Presentation helpers keep source text exact and focused edits explicit.
export function parseCsvSource(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 200000) return null;
  const input = text.replace(/\r\n?/g, '\n');
  const rows = [];
  let cells = [], cell = '', quoted = false, afterQuote = false, line = 1, lineStart = 1;
  const endCell = () => { cells.push(cell); cell = ''; afterQuote = false; };
  const endRow = () => { endCell(); rows.push({ cells, lineStart, lineEnd: line }); cells = []; lineStart = line + 1; };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; afterQuote = true; }
      else { cell += ch; if (ch === '\n') line++; }
    } else if (ch === '"') {
      if (cell || afterQuote) return null;
      quoted = true;
    } else if (ch === ',') endCell();
    else if (ch === '\n') { endRow(); line++; }
    else {
      if (afterQuote) return null;
      cell += ch;
    }
    if (rows.length > 500) return null;
  }
  if (quoted) return null;
  if (cell || cells.length || afterQuote) { endCell(); rows.push({ cells, lineStart, lineEnd: line }); }
  if (rows.length < 2 || rows[0].cells.length < 2 || rows[0].cells.length > 20) return null;
  if (rows.some(row => row.cells.length !== rows[0].cells.length)) return null;
  return { headers: rows[0].cells, headerLine: rows[0].lineStart, rows: rows.slice(1) };
}

export function referencedSourceIds(value) {
  const found = new Set();
  const visit = item => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (typeof item.sourceId === 'string' && Number.isInteger(item.lineStart)) found.add(item.sourceId);
    Object.values(item).forEach(visit);
  };
  visit(value);
  return [...found];
}

export const paymentTopics = {
  receipt: { label: 'Money received', question: 'What money actually arrived?', hint: 'Keep a stated net amount separate from money you can confirm receiving.' },
  identity: { label: 'One payment', question: 'Do these records describe one payment?', hint: 'An advice, reprint and bank entry may describe the same transfer. Matching amounts alone do not establish that.' },
  additionality: { label: 'Additional pay', question: 'Is this additional to pay already counted?', hint: 'A replacement or reissued statement does not automatically add another payment.' },
  coverage: { label: 'Weeks covered', question: 'Does this correction cover only these weeks?', hint: 'A payment date alone does not establish which weeks or kinds of pay it covers.' },
  allocation: { label: 'Split between weeks', question: 'How is this correction split?', hint: 'The correction is counted once. Keep its split unknown if the records do not establish it.' },
};

const amount = value => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  const cents = Math.round(parsed * 100);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(cents) || cents < 0 || cents > 10000000000) throw new Error('Enter a valid amount of zero or more.');
  return cents;
};

export function focusedPaymentCorrection(analysis, paymentId, topic, choice, values = {}) {
  const next = structuredClone(analysis);
  const payment = next.payments.find(item => item.id === paymentId);
  if (!payment || !paymentTopics[topic]) throw new Error('This payment is no longer in the selected account.');
  if (choice === 'keep') return next;
  if (topic === 'receipt') {
    if (choice === 'received') {
      payment.receivedNetCents = amount(values.received);
      if (payment.receivedNetCents === null) throw new Error('Enter the amount you received, or keep receipt uncertain.');
      payment.receiptStatus = 'worker_reported';
      if (payment.netCents !== null && payment.receivedNetCents !== payment.netCents && payment.creditStatus !== 'excluded') payment.creditStatus = 'unresolved';
    } else if (choice === 'not_received' || choice === 'uncertain') {
      payment.receiptStatus = choice === 'not_received' ? 'not_received' : 'unknown';
      payment.receivedNetCents = null;
      payment.creditStatus = 'unresolved';
    } else throw new Error('Choose what is known about receipt.');
  } else if (topic === 'identity') {
    if (!['supported', 'uncertain'].includes(choice)) throw new Error('Choose how to treat the payment match.');
    payment.identityStatus = choice;
    if (choice === 'uncertain') payment.creditStatus = 'unresolved';
  } else if (topic === 'additionality') {
    if (!['supported', 'not_additional', 'uncertain'].includes(choice)) throw new Error('Choose how this relates to earlier pay.');
    payment.additionality = choice === 'uncertain' ? 'unknown' : choice;
    if (choice !== 'supported') payment.creditStatus = choice === 'not_additional' ? 'excluded' : 'unresolved';
  } else if (topic === 'coverage') {
    if (!['supported', 'uncertain'].includes(choice)) throw new Error('Choose what is known about coverage.');
    if (choice === 'supported' && !payment.periodIds.length) throw new Error('Choose the covered weeks in the full editor before confirming exclusive coverage.');
    payment.allocationScope = choice === 'supported' ? 'exclusive_supported' : 'unknown';
    if (choice === 'uncertain') payment.creditStatus = 'unresolved';
  } else if (topic === 'allocation') {
    if (choice === 'uncertain') { payment.allocationStatus = 'unknown'; payment.allocations = []; }
    else if (choice === 'known') {
      if (!payment.periodIds.length) throw new Error('Choose the covered weeks in the full editor before entering a split.');
      const entries = payment.periodIds.map(periodId => ({ periodId, grossCents: amount(values.allocations?.[periodId]) }));
      if (entries.some(entry => entry.grossCents === null)) throw new Error('Enter an amount for each listed week, including zero, or keep the split uncertain.');
      if (payment.grossCents === null || entries.reduce((sum, entry) => sum + entry.grossCents, 0) !== payment.grossCents) throw new Error('The split must add up to the stated gross correction.');
      payment.allocationStatus = 'known'; payment.allocations = entries;
    } else throw new Error('Choose whether the split is known.');
  }
  // A positive edit is not permission to override another unresolved premise or
  // an explicitly excluded credit. Restore a previously unresolved credit only
  // when every factual eligibility premise is now supplied by this account.
  if (payment.creditStatus === 'unresolved' && payment.identityStatus === 'supported' && payment.additionality === 'supported' && payment.allocationScope === 'exclusive_supported' && ['documented', 'worker_reported'].includes(payment.receiptStatus) && payment.grossCents !== null && (payment.netCents === null || payment.receivedNetCents === null || payment.netCents === payment.receivedNetCents)) payment.creditStatus = 'proposed_credit';
  return next;
}

export function paymentStatement(payment, topic, periods = []) {
  if (topic === 'receipt') return payment.receiptStatus === 'not_received' ? 'This payment is recorded as not received.' : payment.receiptStatus === 'unknown' ? 'Receipt is not established.' : 'Receipt is supported by the records or an attributed account.';
  if (topic === 'identity') return payment.identityStatus === 'supported' ? 'These records are represented as one distinct payment.' : 'The payment relationship still needs a supported account.';
  if (topic === 'additionality') return payment.additionality === 'not_additional' ? 'This is not treated as additional pay.' : payment.additionality === 'supported' ? 'This correction is treated as additional to earlier pay.' : 'Whether this is additional pay remains unconfirmed.';
  if (topic === 'coverage') return !payment.periodIds.length ? 'No covered weeks are listed yet. Add a supported period scope in the full editor when it is known.' : payment.allocationScope === 'exclusive_supported' ? `The proposed scope is limited to ${payment.periodIds.map(id => periods.find(p => p.id === id)?.label || 'a listed period').join(' and ')}.` : 'Exclusive coverage of the listed weeks is not established.';
  return payment.allocationStatus === 'known' ? 'The account contains a stated split of this correction.' : 'The split between the listed weeks remains unknown.';
}
