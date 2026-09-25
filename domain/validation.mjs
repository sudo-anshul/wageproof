import { analysisSchema, normalizeSources } from './schema.mjs';

function checkSchema(value, schema, path, errors) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (!types.some((type) => type === actual || (type === 'integer' && actual === 'number' && Number.isSafeInteger(value)))) {
    errors.push(`${path}: expected ${types.join(' or ')}, got ${actual}.`);
    return;
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: must be ${JSON.stringify(schema.const)}.`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: invalid value ${JSON.stringify(value)}.`);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push(`${path}: number must be finite.`);
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}.`);
  }
  if (actual === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required.`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties ?? {}, key)) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key}: unexpected property.`);
      } else checkSchema(value[key], schema.properties[key], `${path}.${key}`, errors);
    }
  }
  if (actual === 'array') value.forEach((item, index) => checkSchema(item, schema.items, `${path}[${index}]`, errors));
}

function visitCitations(value, path, callback) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((item, index) => visitCitations(item, `${path}[${index}]`, callback));
  if (Array.isArray(value.citations)) value.citations.forEach((citation, index) => callback(citation, `${path}.citations[${index}]`));
  for (const [key, item] of Object.entries(value)) if (key !== 'citations') visitCitations(item, `${path}.${key}`, callback);
}

const duplicateItems = (items) => items.filter((value, index) => items.indexOf(value) !== index);
const dateMillis = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
};

export function analysisShapeErrors(analysis) {
  const errors = [];
  checkSchema(analysis, analysisSchema, 'analysis', errors);
  return errors;
}

export function validateAnalysis(analysis, sources = []) {
  const errors = analysisShapeErrors(analysis);
  const warnings = [];
  if (errors.length) return { valid: false, errors, warnings, analysis };
  const normalizedSources = normalizeSources(sources);
  const sourceMap = new Map(normalizedSources.map((source) => [source.id, source]));
  if (duplicateItems(normalizedSources.map((source) => source.id)).length) errors.push('Source IDs must be unique.');
  visitCitations(analysis, 'analysis', (citation, path) => {
    const source = sourceMap.get(citation.sourceId);
    if (!source) { errors.push(`${path}: unknown source ${citation.sourceId}.`); return; }
    const lines = source.text.split('\n');
    if (citation.lineStart > citation.lineEnd || citation.lineEnd > lines.length) {
      errors.push(`${path}: line range is outside ${source.name} (${lines.length} lines).`);
      return;
    }
    if (!citation.quote.trim()) { errors.push(`${path}: quote must not be empty.`); return; }
    const span = lines.slice(citation.lineStart - 1, citation.lineEnd).join('\n');
    if (!span.includes(citation.quote.replace(/\r\n?/g, '\n'))) errors.push(`${path}: quote does not occur verbatim in the cited lines.`);
  });
  const collections = ['periods', 'payments', 'issues', 'responseClaims', 'actions'];
  for (const collection of collections) {
    for (const entity of analysis[collection]) {
      if (!entity.id.trim()) errors.push(`${collection}: entity ID must not be blank.`);
      if (!entity.citations.length && collection !== 'actions') errors.push(`${collection}.${entity.id}: at least one source citation is required.`);
    }
    for (const id of duplicateItems(analysis[collection].map((entity) => entity.id))) errors.push(`${collection}: duplicate ID ${id}.`);
  }
  if (!analysis.scope.citations.length && analysis.scope.basisStatus !== 'unknown') errors.push('scope: supplied/proposed rule premises need a source citation.');
  if (!analysis.caseContext.citations.length && [analysis.caseContext.workerName, analysis.caseContext.employerName, analysis.caseContext.claimNumber].some(Boolean)) warnings.push('Case context has no documentary citation; preserve its user-supplied attribution.');
  const periodIds = new Set(analysis.periods.map((period) => period.id));
  const paymentIds = new Set(analysis.payments.map((payment) => payment.id));
  const issueIds = new Set(analysis.issues.map((issue) => issue.id));
  const references = (values, available, label) => {
    if (duplicateItems(values).length) errors.push(`${label}: repeated reference.`);
    for (const id of values) if (!available.has(id)) errors.push(`${label}: unknown reference ${id}.`);
  };
  for (const item of [...analysis.payments, ...analysis.issues, ...analysis.responseClaims]) references(item.periodIds, periodIds, `${item.id}.periodIds`);
  for (const item of [...analysis.issues, ...analysis.responseClaims]) references(item.paymentIds, paymentIds, `${item.id}.paymentIds`);
  for (const item of analysis.responseClaims) references(item.issueIds, issueIds, `${item.id}.issueIds`);
  for (const item of analysis.actions) references(item.dependsOnIssueIds, issueIds, `${item.id}.dependsOnIssueIds`);
  for (const action of analysis.actions) {
    if ((['answered','partly_answered','superseded'].includes(action.status)||(action.status==='closed'&&action.route!=='review_available')) && !action.citations.length) errors.push(`${action.id}: a factual answer, closure or replacement needs source support.`);
    const outstanding = action.dependsOnIssueIds.filter(id => ['open','unassessed'].includes(analysis.issues.find(issue => issue.id === id)?.status));
    if (action.status === 'answered' && outstanding.length) errors.push(`${action.id}: an answered request still depends on unresolved questions; keep it partly_answered or replace it with the remaining request.`);
    if (['superseded','closed'].includes(action.status)) {
      for (const issueId of outstanding) if (!analysis.actions.some(other => other.id !== action.id && ['open','partly_answered'].includes(other.status) && other.dependsOnIssueIds.includes(issueId))) errors.push(`${action.id}: the replacement request must preserve unresolved question ${issueId}.`);
    }
  }
  const datedPeriods = new Map();
  for (const period of analysis.periods) {
    if (period.days.length && period.alternatives.length) errors.push(`${period.id}: use daily account or complete alternatives, not both.`);
    if (period.calculationBasis === 'daily_minutes' && !period.days.length && !period.alternatives.length) errors.push(`${period.id}: daily_minutes requires a work account.`);
    if (period.calculationBasis === 'daily_minutes' && period.rateCents === null) errors.push(`${period.id}: daily_minutes requires a supported regular rate.`);
    if (period.calculationBasis === 'daily_minutes' && period.rateCents === 0) errors.push(`${period.id}: regular rate must be positive for a wage calculation.`);
    if (period.calculationBasis === 'reviewed_earned' && period.reviewedGrossEarnedCents === null) errors.push(`${period.id}: reviewed_earned requires the supplied adopted gross amount.`);
    if (period.calculationBasis !== 'reviewed_earned' && period.reviewedGrossEarnedCents !== null) errors.push(`${period.id}: reviewedGrossEarnedCents belongs only to reviewed_earned.`);
    if (duplicateItems(period.alternatives.map((alternative) => alternative.id)).length) errors.push(`${period.id}: alternative IDs must be unique.`);
    for (const field of ['startDate', 'endDate']) if (period[field] !== null && dateMillis(period[field]) === null) errors.push(`${period.id}.${field}: use a valid ISO calendar date or null.`);
    const start = dateMillis(period.startDate);
    const end = dateMillis(period.endDate);
    if (start !== null && end !== null && (end < start || end - start > 6 * 86400000)) errors.push(`${period.id}: a workweek interval must be ordered and span no more than seven calendar dates.`);
    const accounts = period.alternatives.length ? period.alternatives.map((alternative) => alternative.days) : [period.days];
    for (const days of accounts) {
      if (days.length > 7) errors.push(`${period.id}: one calculation period cannot exceed seven workdays.`);
      if (duplicateItems(days.filter((day) => day.date).map((day) => day.date)).length) errors.push(`${period.id}: repeated date in a daily account.`);
      for (const day of days) {
        if (day.date !== null && dateMillis(day.date) === null) { errors.push(`${period.id}: work dates must be valid ISO calendar dates or null.`); continue; }
        if (day.date !== null) {
          const date = dateMillis(day.date);
          if ((start !== null && date < start) || (end !== null && date > end)) errors.push(`${period.id}: work date ${day.date} is outside its declared period.`);
          if (day.minutes > 0) {
            const earlier = datedPeriods.get(day.date);
            if (earlier && earlier !== period.id) errors.push(`${period.id}: worked date ${day.date} is already represented by period ${earlier}.`);
            datedPeriods.set(day.date, period.id);
          }
        }
      }
      if (days.filter((day) => day.minutes > 0).length === 7) warnings.push(`${period.id}: seventh-day rules are outside the supported calculation slice; amount will remain unassessed.`);
    }
  }
  const creditedRefs = new Set();
  for (const payment of analysis.payments) {
    if (payment.allocationStatus === 'unknown' && payment.allocations.length) errors.push(`${payment.id}: an unknown allocation must not contain a guessed split.`);
    if (payment.allocationStatus === 'known') {
      if (!payment.allocations.length) errors.push(`${payment.id}: known allocation requires at least one allocation.`);
      const allocationIds = payment.allocations.map((allocation) => allocation.periodId);
      references(allocationIds, periodIds, `${payment.id}.allocations`);
      if (allocationIds.some((id) => !payment.periodIds.includes(id))) errors.push(`${payment.id}: allocation is outside its declared period scope.`);
      if (payment.grossCents === null || payment.allocations.reduce((sum, allocation) => sum + allocation.grossCents, 0) !== payment.grossCents) errors.push(`${payment.id}: known allocations must sum to the full known gross amount.`);
    }
    if (payment.netCents !== null && payment.grossCents !== null && payment.netCents > payment.grossCents) warnings.push(`${payment.id}: net exceeds gross; check whether this receipt includes other components.`);
    if (payment.creditStatus === 'proposed_credit') {
      if (payment.grossCents === null) errors.push(`${payment.id}: gross amount is required to propose a gross wage credit.`);
      if (payment.identityStatus !== 'supported' || payment.additionality !== 'supported') errors.push(`${payment.id}: a proposed credit requires supported distinct identity and additionality.`);
      if (!['documented', 'worker_reported'].includes(payment.receiptStatus)) errors.push(`${payment.id}: issued or uncertain receipt cannot support a received-payment credit.`);
      if (payment.allocationScope !== 'exclusive_supported' || !payment.periodIds.length) errors.push(`${payment.id}: proposed credit requires supported exclusive period scope.`);
      if (payment.netCents !== null && payment.receivedNetCents !== null && payment.netCents !== payment.receivedNetCents) errors.push(`${payment.id}: differing expected and received net amounts do not establish receipt of the full correction.`);
      if (payment.eventReference) {
        const reference = payment.eventReference.trim().toLocaleLowerCase();
        if (creditedRefs.has(reference)) errors.push(`${payment.id}: the same event reference is already credited; supporting views must be merged.`);
        creditedRefs.add(reference);
      } else warnings.push(`${payment.id}: payment has no reference; inspect the cited identity basis carefully.`);
    }
  }
  if (!analysis.unassessedCategories.length) warnings.push('List payment timing and other unassessed categories; a scoped zero is not whole-case closure.');
  if (analysis.scope.basisStatus !== 'supplied') warnings.push('The ordinary legal calculation scope is not supplied/adopted; new calculations from hours remain unassessed. Explicitly adopted gross amounts may still support retained-account reconciliation.');
  return { valid: errors.length === 0, errors, warnings, analysis };
}
