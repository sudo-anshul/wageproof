const str = { type: 'string' };
const nullableString = { type: ['string', 'null'] };
const cents = { type: ['integer', 'null'], minimum: 0, maximum: 10000000000 };
const arr = (items) => ({ type: 'array', items });
const en = (...values) => ({ type: 'string', enum: values });
const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const citation = object({ sourceId: str, lineStart: { type: 'integer', minimum: 1 }, lineEnd: { type: 'integer', minimum: 1 }, quote: str });
const citations = arr(citation);
const day = object({ date: nullableString, label: str, minutes: { type: ['integer', 'null'], minimum: 0, maximum: 1440 }, citations });
const ids = arr(str);

export const analysisSchema = object({
  schemaVersion: { type: 'string', const: '1.0' },
  summary: str,
  caseContext: object({
    workerName: nullableString, employerName: nullableString, claimNumber: nullableString,
    claimStatus: en('pending', 'not_filed', 'unknown'), purpose: str, recipient: nullableString,
    asOf: nullableString, attribution: str, citations,
  }),
  scope: object({
    jurisdiction: en('CA', 'other', 'unknown'), rule: en('ca_ordinary_hourly', 'unassessed'),
    basisStatus: en('supplied', 'proposed', 'unknown'), assumptions: arr(str),
    workweek: nullableString, workday: nullableString, exclusions: arr(str), citations,
  }),
  periods: arr(object({
    id: str, label: str, startDate: nullableString, endDate: nullableString,
    rateCents: cents, originalGrossPaidCents: cents,
    calculationBasis: en('daily_minutes', 'reviewed_earned', 'unassessed'),
    reviewedGrossEarnedCents: cents, days: arr(day),
    alternatives: arr(object({ id: str, label: str, days: arr(day) })),
    notes: str, citations,
  })),
  payments: arr(object({
    id: str, label: str, eventReference: nullableString,
    grossCents: cents, netCents: cents, receivedNetCents: cents, paymentDate: nullableString,
    receiptStatus: en('documented', 'worker_reported', 'unknown', 'not_received'),
    identityStatus: en('supported', 'asserted', 'uncertain'),
    additionality: en('supported', 'asserted', 'unknown', 'not_additional'),
    creditStatus: en('proposed_credit', 'unresolved', 'excluded'), creditReason: str,
    allocationStatus: en('known', 'unknown'),
    allocationScope: en('exclusive_supported', 'exclusive_asserted', 'unknown'),
    periodIds: ids,
    allocations: arr(object({ periodId: str, grossCents: { type: 'integer', minimum: 0, maximum: 10000000000 } })),
    citations,
  })),
  issues: arr(object({
    id: str, title: str, status: en('open', 'answered', 'resolved', 'unassessed'), detail: str,
    materiality: en('identity', 'scope', 'allocation', 'work_account', 'support', 'other'),
    periodIds: ids, paymentIds: ids, citations,
  })),
  responseClaims: arr(object({
    id: str, statement: str, author: str,
    status: en('supported', 'partly_supported', 'unsupported', 'unassessed'), coverage: str,
    periodIds: ids, paymentIds: ids, issueIds: ids, citations,
  })),
  actions: arr(object({
    id: str, title: str, detail: str, status: en('open', 'partly_answered', 'answered', 'superseded', 'closed'),
    route: en('review_available', 'ordinary_request', 'payroll_record_request', 'deputy_update', 'seek_help'),
    priority: en('high', 'normal', 'low'), custodian: nullableString, dateRange: nullableString,
    establishes: str, dependsOnIssueIds: ids, citations,
  })),
  unassessedCategories: arr(str),
  changeNarrative: str,
});

export const normalizeSources = (sources = []) => sources.map((source) => ({
  ...source,
  id: String(source.id ?? source.sourceId ?? ''),
  name: String(source.name ?? source.filename ?? source.id ?? source.sourceId ?? 'Source'),
  text: String(source.text ?? source.content ?? '').replace(/\r\n?/g, '\n'),
}));
