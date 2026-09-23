import { formatMoney } from './supplement.mjs';
import { analysisShapeErrors } from './validation.mjs';

function canonical(value, includeCitations = true) {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, includeCitations)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter((key) => includeCitations || key !== 'citations').sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key], includeCitations)}`).join(',')}}`;
  return JSON.stringify(value);
}

const readable = (value, field) => {
  if (value === undefined) return '(not present)';
  if (value === null) return 'unknown (null)';
  if (Number.isSafeInteger(value) && /Cents$/.test(field)) return `${formatMoney(value)} (${value} cents)`;
  if (Number.isSafeInteger(value) && field === 'minutes') return `${value} minutes`;
  return JSON.stringify(value);
};
const uniqueCitations = (citations) => [...new Map(citations.map((citation) => [canonical(citation), citation])).values()];
const append = (original, attribution) => original ? `${original}\n\n${attribution}` : attribution;

/**
 * Make a new, immutable source for factual changes made through an editor.
 * This function does not persist anything or assert that an edit is true.
 * The caller must atomically store the source and validate the returned analysis.
 */
export function annotateUserCorrection(previousAnalysis, nextAnalysis, { sourceId, reason, actor = 'User' } = {}) {
  if (!previousAnalysis || !nextAnalysis || typeof previousAnalysis !== 'object' || typeof nextAnalysis !== 'object') throw new TypeError('A previous and next complete analysis are required.');
  if (typeof sourceId !== 'string' || !sourceId.trim()) throw new TypeError('A stable correction sourceId is required.');
  if (typeof reason !== 'string' || !reason.trim()) throw new TypeError('Describe the reason for the user-entered correction.');
  if (typeof actor !== 'string' || !actor.trim()) throw new TypeError('Identify the correction actor.');
  if (previousAnalysis.schemaVersion !== nextAnalysis.schemaVersion) throw new TypeError('A user correction cannot change the analysis schema version.');
  for (const [label, value] of [['Previous', previousAnalysis], ['Corrected', nextAnalysis]]) {
    const errors = analysisShapeErrors(value);
    if (errors.length) throw new TypeError(`${label} analysis does not match the schema: ${errors.slice(0, 5).join(' ')}`);
  }

  const semanticSame = canonical(previousAnalysis, false) === canonical(nextAnalysis, false);
  if (semanticSame) {
    if (canonical(previousAnalysis) !== canonical(nextAnalysis)) {
      const error = new Error('Citation-only edits cannot silently rewrite provenance. Add an attributed source note and reanalyse instead.');
      error.code = 'CORRECTION_PROVENANCE_ONLY';
      throw error;
    }
    return { analysis: structuredClone(previousAnalysis), text: '', changed: false, changes: [] };
  }

  const analysis = structuredClone(nextAnalysis);
  const changes = [];
  const targets = new Map();
  const originalCitations = new Map();
  const unanchored = [];
  const allPriorCitations = [];
  const add = (path, before, after, ancestors, field) => {
    const change = { path, before: before === undefined ? null : structuredClone(before), after: after === undefined ? null : structuredClone(after), beforePresent: before !== undefined, afterPresent: after !== undefined };
    const index = changes.length;
    changes.push({ ...change, display: `${path}: ${readable(before, field)} → ${readable(after, field)}` });
    if (!ancestors.length) unanchored.push(index);
    for (const target of ancestors) {
      if (!targets.has(target)) targets.set(target, []);
      targets.get(target).push(index);
    }
  };
  const walk = (before, after, path, ancestors = [], field = '') => {
    if (canonical(before, false) === canonical(after, false)) return;
    let currentAncestors = ancestors;
    if (after && typeof after === 'object' && !Array.isArray(after) && Array.isArray(after.citations)) {
      currentAncestors = [...ancestors, after];
      originalCitations.set(after, uniqueCitations([...(Array.isArray(before?.citations) ? before.citations : []), ...after.citations]));
    }
    if (before && typeof before === 'object' && !Array.isArray(before) && Array.isArray(before.citations)) allPriorCitations.push(...before.citations);
    if (Array.isArray(before) || Array.isArray(after)) {
      const oldArray = Array.isArray(before) ? before : [];
      const nextArray = Array.isArray(after) ? after : [];
      const byId = [...oldArray, ...nextArray].length > 0 && [...oldArray, ...nextArray].every((item) => item && typeof item === 'object' && typeof item.id === 'string');
      if (byId) {
        const oldMap = new Map(oldArray.map((item) => [item.id, item]));
        const nextMap = new Map(nextArray.map((item) => [item.id, item]));
        for (const id of new Set([...oldMap.keys(), ...nextMap.keys()])) walk(oldMap.get(id), nextMap.get(id), `${path}[${JSON.stringify(id)}]`, currentAncestors, field);
        if (oldArray.length === nextArray.length && oldArray.every((item) => nextMap.has(item.id)) && oldArray.map((item) => item.id).join('\u0000') !== nextArray.map((item) => item.id).join('\u0000')) add(`${path}.order`, oldArray.map((item) => item.id), nextArray.map((item) => item.id), currentAncestors, 'order');
      } else {
        for (let index = 0; index < Math.max(oldArray.length, nextArray.length); index++) walk(oldArray[index], nextArray[index], `${path}[${index}]`, currentAncestors, field);
      }
      return;
    }
    const oldObject = before !== null && typeof before === 'object';
    const nextObject = after !== null && typeof after === 'object';
    if (oldObject || nextObject) {
      for (const key of new Set([...Object.keys(oldObject ? before : {}), ...Object.keys(nextObject ? after : {})])) {
        if (key !== 'citations') walk(oldObject ? before[key] : undefined, nextObject ? after[key] : undefined, path ? `${path}.${key}` : key, currentAncestors, key);
      }
      return;
    }
    add(path, before, after, currentAncestors, field);
  };
  walk(previousAnalysis, analysis, '');

  const actorText = actor.trim();
  const reasonText = reason.trim();
  const lines = [
    '# Attributed user-entered correction',
    `Actor: ${JSON.stringify(actorText)}`,
    `Reason: ${JSON.stringify(reasonText)}`,
    'These are proposed changes entered by the named actor, not a finding that the earlier records were wrong and not a legal adjudication. Original evidence is retained for comparison; this source supplies the changed statements only.',
    '', 'Changes entered:',
    ...changes.map((change) => `- ${change.display}`),
  ];
  const firstChangeLine = 7;
  const prior = uniqueCitations(allPriorCitations);
  if (prior.length) {
    lines.push('', 'Original evidence retained for comparison (it may contradict the correction):');
    for (const citation of prior) lines.push(`- ${JSON.stringify(citation.sourceId)}, lines ${citation.lineStart}–${citation.lineEnd}: ${JSON.stringify(citation.quote)}`);
  }
  const text = `${lines.join('\n')}\n`;
  const anchor = (indices) => {
    const lineStart = firstChangeLine + Math.min(...indices);
    const lineEnd = firstChangeLine + Math.max(...indices);
    return { sourceId, lineStart, lineEnd, quote: lines.slice(lineStart - 1, lineEnd).join('\n') };
  };
  const attribution = `User-entered correction by ${actorText}: ${reasonText}. The correction note supplies the changed fields; earlier citations remain for comparison, including potentially contrary evidence.`;

  // Top-level prose, category edits, reordering and deletions have no local
  // citation property; caseContext.attribution records their provenance.
  if (unanchored.length) {
    if (!analysis.caseContext || !Array.isArray(analysis.caseContext.citations)) throw new TypeError('A complete caseContext with citations is required.');
    if (!targets.has(analysis.caseContext)) targets.set(analysis.caseContext, []);
    targets.get(analysis.caseContext).push(...unanchored);
    if (!originalCitations.has(analysis.caseContext)) originalCitations.set(analysis.caseContext, uniqueCitations([...(previousAnalysis.caseContext?.citations ?? []), ...analysis.caseContext.citations]));
  }
  for (const [target, indices] of targets) {
    target.citations = [anchor(indices), ...uniqueCitations(originalCitations.get(target) ?? target.citations ?? [])];
    if (typeof target.notes === 'string') target.notes = append(target.notes, attribution);
    else if (typeof target.creditReason === 'string') target.creditReason = append(target.creditReason, attribution);
    else if (typeof target.coverage === 'string') target.coverage = append(target.coverage, attribution);
    else if (typeof target.detail === 'string') target.detail = append(target.detail, attribution);
    else if (target === analysis.caseContext) target.attribution = append(target.attribution, attribution);
    else if (target === analysis.scope) target.assumptions = [...target.assumptions, attribution];
  }
  analysis.changeNarrative = append(analysis.changeNarrative, `This version contains ${changes.length} user-entered field change(s) by ${actorText}. Reason: ${reasonText}. These are proposed working-account corrections, not legal determinations.`);
  return { analysis, text, changed: true, changes };
}
