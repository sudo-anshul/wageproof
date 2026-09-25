function earnedForDays(days, rateCents) {
  if (!days.length || days.length > 7 || days.some((day) => !Number.isSafeInteger(day.minutes) || day.minutes < 0 || day.minutes > 1440)) return { calculated: false, reason: 'A complete supported daily-work account is missing.' };
  if (days.filter((day) => day.minutes > 0).length === 7) return { calculated: false, reason: 'Seventh-day rules require a separate supported rule scope.' };
  let regularMinutes = 0;
  let overtimeMinutes = 0;
  let doubletimeMinutes = 0;
  for (const { minutes } of days) {
    regularMinutes += Math.min(minutes, 480);
    overtimeMinutes += Math.min(Math.max(minutes - 480, 0), 240);
    doubletimeMinutes += Math.max(minutes - 720, 0);
  }
  const weeklyOvertimeMinutes = Math.max(regularMinutes - 2400, 0);
  regularMinutes -= weeklyOvertimeMinutes;
  overtimeMinutes += weeklyOvertimeMinutes;
  // Compute an exact integer numerator, then round the workweek's total to cents.
  const numerator = rateCents * (regularMinutes * 2 + overtimeMinutes * 3 + doubletimeMinutes * 4);
  if (!Number.isSafeInteger(numerator)) return { calculated: false, reason: 'Calculation exceeds the safe integer range.' };
  return { calculated: true, grossEarnedCents: Math.round(numerator / 120), regularMinutes, overtimeMinutes, doubletimeMinutes, weeklyOvertimeMinutes, rounding: 'Nearest cent on the workweek total; half cents round upward.' };
}

function calculatePeriod(period, scope) {
  // Carrying forward an expressly adopted amount is an accounting operation,
  // not a new calculation of legal entitlement from hours or a rate. Missing
  // rule/workday premises must not erase that supplied historical account.
  if (period.calculationBasis === 'reviewed_earned' && Number.isSafeInteger(period.reviewedGrossEarnedCents) && period.reviewedGrossEarnedCents >= 0) {
    return { calculated: true, min: period.reviewedGrossEarnedCents, max: period.reviewedGrossEarnedCents, alternatives: [], basis: 'Supplied previously adopted gross amount; not independently recalculated.' };
  }
  if (period.calculationBasis === 'unassessed') return { calculated: false, alternatives: [], reason: 'The gross-earned account for this period remains unassessed.' };
  const scopeReady = scope?.jurisdiction === 'CA' && scope?.rule === 'ca_ordinary_hourly' && scope?.basisStatus === 'supplied' && Boolean(scope?.workweek) && Boolean(scope?.workday);
  if (!scopeReady) return { calculated: false, alternatives: [], reason: 'The jurisdiction, ordinary scope, workweek and workday must be explicitly supplied.' };
  if (period.calculationBasis !== 'daily_minutes' || !Number.isSafeInteger(period.rateCents) || period.rateCents <= 0) return { calculated: false, alternatives: [], reason: 'Rate or calculation basis is unassessed.' };
  const accounts = period.alternatives?.length ? period.alternatives : [{ id: `${period.id}-daily`, label: 'Supplied daily account', days: period.days ?? [] }];
  const alternatives = accounts.map((account) => ({ id: account.id, label: account.label, ...earnedForDays(account.days, period.rateCents) }));
  if (alternatives.some((alternative) => !alternative.calculated)) return { calculated: false, alternatives, reason: alternatives.find((alternative) => !alternative.calculated).reason };
  return { calculated: true, min: Math.min(...alternatives.map((alternative) => alternative.grossEarnedCents)), max: Math.max(...alternatives.map((alternative) => alternative.grossEarnedCents)), alternatives, basis: 'Conditional ordinary California hourly calculation.' };
}

function creditEligibility(payment, periodIds) {
  const reasons = [];
  if (payment.creditStatus !== 'proposed_credit') reasons.push(payment.creditReason || 'Payment is unresolved or excluded.');
  if (!Number.isSafeInteger(payment.grossCents) || payment.grossCents < 0) reasons.push('Gross amount is not known.');
  if (payment.identityStatus !== 'supported') reasons.push('Distinct payment identity is not supported.');
  if (payment.additionality !== 'supported') reasons.push('Additionality to original pay is not supported.');
  if (!['documented', 'worker_reported'].includes(payment.receiptStatus)) reasons.push('Actual receipt is not supported.');
  if (payment.netCents !== null && payment.receivedNetCents !== null && payment.netCents !== payment.receivedNetCents) reasons.push('Full expected net receipt is not established.');
  if (payment.allocationScope !== 'exclusive_supported') reasons.push('Exclusive period scope is not supported.');
  if (!payment.periodIds?.length || payment.periodIds.some((id) => !periodIds.has(id))) reasons.push('Valid period scope is missing.');
  if (payment.allocationStatus === 'known') {
    const allocations = payment.allocations ?? [];
    if (!allocations.length || allocations.reduce((sum, item) => sum + item.grossCents, 0) !== payment.grossCents || allocations.some((item) => !Number.isSafeInteger(item.grossCents) || item.grossCents < 0 || !payment.periodIds.includes(item.periodId)) || new Set(allocations.map((item) => item.periodId)).size !== allocations.length) reasons.push('Known allocation does not conserve the payment.');
  } else if (payment.allocationStatus !== 'unknown' || payment.allocations?.length) reasons.push('Unknown allocation contains an invalid or guessed split.');
  return reasons;
}

export function reconcile(analysis) {
  const warnings = [];
  const inputPeriods = analysis?.periods ?? [];
  const periodIds = new Set(inputPeriods.map((period) => period.id));
  const periods = inputPeriods.map((period) => {
    const result = calculatePeriod(period, analysis?.scope);
    const paid = Number.isSafeInteger(period.originalGrossPaidCents) ? period.originalGrossPaidCents : null;
    const calculated = result.calculated && paid !== null;
    if (!result.calculated) warnings.push(`${period.label}: ${result.reason}`);
    if (paid === null) warnings.push(`${period.label}: original gross paid is unknown; do not substitute net receipt.`);
    return {
      id: period.id, label: period.label, calculated,
      earnedMinCents: result.calculated ? result.min : null,
      earnedMaxCents: result.calculated ? result.max : null,
      originalGrossPaidCents: paid,
      initialDifferenceMinCents: calculated ? result.min - paid : null,
      initialDifferenceMaxCents: calculated ? result.max - paid : null,
      knownCreditCents: 0,
      differenceMinCents: calculated ? result.min - paid : null,
      differenceMaxCents: calculated ? result.max - paid : null,
      alternatives: result.alternatives, allocationGroupIds: [], basis: result.basis ?? result.reason,
    };
  });
  const periodMap = new Map(periods.map((period) => [period.id, period]));
  const allocationGroups = [];
  const references = new Set();
  const payments = (analysis?.payments ?? []).map((payment) => {
    const reasons = creditEligibility(payment, periodIds);
    const reference = payment.eventReference?.trim().toLocaleLowerCase();
    if (reference && references.has(reference)) reasons.push('Duplicate credited event reference.');
    if (!reasons.length && reference) references.add(reference);
    const credited = reasons.length === 0;
    if (!credited) warnings.push(`${payment.label}: not credited in this schedule. ${reasons.join(' ')}`);
    if (credited && (payment.allocationStatus === 'known' || payment.periodIds.length === 1)) {
      const allocations = payment.allocationStatus === 'known' ? payment.allocations : [{ periodId: payment.periodIds[0], grossCents: payment.grossCents }];
      for (const allocation of allocations) {
        const period = periodMap.get(allocation.periodId);
        period.knownCreditCents += allocation.grossCents;
        if (period.calculated) { period.differenceMinCents -= allocation.grossCents; period.differenceMaxCents -= allocation.grossCents; }
      }
    } else if (credited) {
      const groupId = `allocation-${payment.id}`;
      allocationGroups.push({
        id: groupId, paymentId: payment.id, label: payment.label,
        totalGrossCents: payment.grossCents, periodIds: [...payment.periodIds],
        allocationsKnown: false,
        possibleCentAllocations: payment.periodIds.length === 2 ? payment.grossCents + 1 : null,
        constraint: `Nonnegative integer-cent allocations to the listed periods sum to ${payment.grossCents} cents. The period bounds are linked, not independently selectable.`,
      });
      for (const periodId of payment.periodIds) {
        const period = periodMap.get(periodId);
        period.allocationGroupIds.push(groupId);
        if (period.calculated) period.differenceMinCents -= payment.grossCents;
      }
    }
    return { ...payment, credited, creditedGrossCents: credited ? payment.grossCents : 0, exclusionReasons: reasons };
  });
  const sum = (key) => periods.reduce((total, period) => total + period[key], 0);
  const earnedKnown = periods.length > 0 && periods.every((period) => period.earnedMinCents !== null);
  const paidKnown = periods.length > 0 && periods.every((period) => period.originalGrossPaidCents !== null);
  const calculable = periods.length > 0 && periods.every((period) => period.calculated);
  const creditedGrossCents = payments.reduce((total, payment) => total + payment.creditedGrossCents, 0);
  const totals = {
    earnedMinCents: earnedKnown ? sum('earnedMinCents') : null,
    earnedMaxCents: earnedKnown ? sum('earnedMaxCents') : null,
    originalGrossPaidCents: paidKnown ? sum('originalGrossPaidCents') : null,
    initialDifferenceMinCents: calculable ? sum('initialDifferenceMinCents') : null,
    initialDifferenceMaxCents: calculable ? sum('initialDifferenceMaxCents') : null,
    creditedGrossCents,
    differenceMinCents: calculable ? sum('initialDifferenceMinCents') - creditedGrossCents : null,
    differenceMaxCents: calculable ? sum('initialDifferenceMaxCents') - creditedGrossCents : null,
    calculable, conditional: true, label: 'Scoped gross accounting difference',
    uncreditedPaymentCount: payments.filter((payment) => !payment.credited).length,
  };
  // A missing account for one covered period does not erase the other known
  // accounts. Keep their subtotal separate from the complete all-period total.
  const knownPeriods = periods.filter((period) => period.calculated);
  const knownIds = new Set(knownPeriods.map((period) => period.id));
  const knownSum = (key) => knownPeriods.reduce((total, period) => total + period[key], 0);
  const subtotalCalculable = knownPeriods.length > 0;
  let subtotalCreditMin = knownSum('knownCreditCents');
  let subtotalCreditMax = subtotalCreditMin;
  for (const group of allocationGroups) {
    const membersInside = group.periodIds.filter((periodId) => knownIds.has(periodId)).length;
    if (membersInside === group.periodIds.length) {
      // Shared within the subtotal: count the full group once, not once per row.
      subtotalCreditMin += group.totalGrossCents;
      subtotalCreditMax += group.totalGrossCents;
    } else if (membersInside > 0) {
      // Shared with an unknown outside account: the known accounts may receive
      // anywhere from none to all of this credit. Do not assume exclusivity.
      subtotalCreditMax += group.totalGrossCents;
    }
  }
  const knownSubtotal = {
    periodIds: knownPeriods.map((period) => period.id),
    excludedPeriodIds: periods.filter((period) => !period.calculated).map((period) => period.id),
    earnedMinCents: subtotalCalculable ? knownSum('earnedMinCents') : null,
    earnedMaxCents: subtotalCalculable ? knownSum('earnedMaxCents') : null,
    originalGrossPaidCents: subtotalCalculable ? knownSum('originalGrossPaidCents') : null,
    initialDifferenceMinCents: subtotalCalculable ? knownSum('initialDifferenceMinCents') : null,
    initialDifferenceMaxCents: subtotalCalculable ? knownSum('initialDifferenceMaxCents') : null,
    creditedGrossMinCents: subtotalCalculable ? subtotalCreditMin : null,
    creditedGrossMaxCents: subtotalCalculable ? subtotalCreditMax : null,
    differenceMinCents: subtotalCalculable ? knownSum('initialDifferenceMinCents') - subtotalCreditMax : null,
    differenceMaxCents: subtotalCalculable ? knownSum('initialDifferenceMaxCents') - subtotalCreditMin : null,
    calculable: subtotalCalculable,
    complete: calculable,
    label: 'Subtotal for periods with a supplied account',
  };
  if (subtotalCalculable && !calculable) warnings.push('The known-account subtotal excludes periods whose wage accounts remain unassessed. It is not the complete difference across all listed periods.');
  if (allocationGroups.length) warnings.push(`Shared allocation bounds are coupled. Do not add the individual period extrema; use ${calculable ? 'the combined schedule total' : subtotalCalculable ? 'the separately derived known-account subtotal bounds; the complete all-period total remains unassessed' : 'only an aggregate supported by known accounts'}.`);
  if (periods.some((period) => period.differenceMinCents !== null && period.differenceMinCents < 0)) warnings.push('A negative scoped difference is retained as a credit excess under these premises. It does not determine repayment or close other claims.');
  return { periods, payments, totals, knownSubtotal, allocationGroups, warnings, unassessedCategories: [...(analysis?.unassessedCategories ?? [])] };
}
