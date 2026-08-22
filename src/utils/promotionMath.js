"use strict";

// Deliberately duplicated arithmetic, NOT shared with
// reportCard.controller.js's buildReportCardsFromMarks/computeTerm. Same
// formulas, kept intentionally independent so the promotion engine's query
// pattern (lean, raw, chunked) never inherits report-card generation's
// heavier eager-loaded query shape, which is already known to strain the
// production VPS under load. If the report-card rounding/averaging rules
// ever change, this file must be updated to match by hand.
//
// Formulas (must stay identical to reportCard.controller.js):
//   - subject term average = mean of that term's 2 sequence scores
//     (sequence order_number 1-2 => term1, 3-4 => term2, 5-6 => term3,
//     a global 1-6 position across the year, not per-term)
//   - subject annual average = mean of the subject's non-null term averages
//   - class term total = coefficient-weighted mean of subject term averages
//   - overall annual average = mean of the non-zero term totals

const round = (n, d = 1) => {
  const factor = Math.pow(10, d);
  return Math.round((Number(n) + Number.EPSILON) * factor) / factor;
};

/**
 * @param {Array<{subject_id:number, sequence_order:number, score:number}>} marks
 *   Lean, raw mark rows for ONE student, ONE class, ONE academic year.
 * @param {Map<number,{category:string, coefficient:number}>} subjectMeta
 *   subject_id -> category/coefficient, for every subject this class teaches.
 * @returns {{
 *   subjectAverages: Map<number, object>,
 *   termAverages: {term1:number, term2:number, term3:number},
 *   annualAverage: number,
 *   hasIncompleteData: boolean,
 *   gaps: Array<{subject_id:number, missingSequences:number[]}>,
 * }}
 */
function computeStudentAverages(marks, subjectMeta) {
  const bySubject = new Map();
  for (const m of marks) {
    if (!bySubject.has(m.subject_id)) bySubject.set(m.subject_id, {});
    const seqScores = bySubject.get(m.subject_id);
    if (seqScores[m.sequence_order] === undefined) {
      seqScores[m.sequence_order] = Number(m.score);
    }
  }

  const termAvgOfTwo = (a, b) => {
    const valid = [a, b].filter(
      (v) => v !== undefined && v !== null && !isNaN(v)
    );
    if (!valid.length) return null;
    return round(valid.reduce((x, y) => x + y, 0) / valid.length);
  };

  const subjectAverages = new Map();
  const gaps = [];

  for (const [subjectId, meta] of subjectMeta.entries()) {
    const seqScores = bySubject.get(subjectId) || {};
    const term1 = termAvgOfTwo(seqScores[1], seqScores[2]);
    const term2 = termAvgOfTwo(seqScores[3], seqScores[4]);
    const term3 = termAvgOfTwo(seqScores[5], seqScores[6]);
    const termVals = [term1, term2, term3].filter((v) => v !== null);
    const annual = termVals.length
      ? round(termVals.reduce((x, y) => x + y, 0) / termVals.length)
      : null;

    const missingSequences = [1, 2, 3, 4, 5, 6].filter(
      (n) => seqScores[n] === undefined
    );
    if (missingSequences.length > 0) {
      gaps.push({ subject_id: subjectId, missingSequences });
    }

    subjectAverages.set(subjectId, {
      term1,
      term2,
      term3,
      annual,
      category: meta.category,
      coefficient: meta.coefficient,
      name: meta.name,
    });
  }

  const computeTermTotal = (termKey) => {
    let weighted = 0;
    let coefSum = 0;
    for (const avg of subjectAverages.values()) {
      const val = avg[termKey];
      if (val !== null) {
        weighted += val * avg.coefficient;
        coefSum += avg.coefficient;
      }
    }
    return coefSum > 0 ? round(weighted / coefSum) : 0;
  };

  const termAverages = {
    term1: computeTermTotal("term1"),
    term2: computeTermTotal("term2"),
    term3: computeTermTotal("term3"),
  };

  const nonZeroTermAverages = Object.values(termAverages).filter(
    (v) => v > 0
  );
  const annualAverage = nonZeroTermAverages.length
    ? round(
        nonZeroTermAverages.reduce((a, b) => a + b, 0) /
          nonZeroTermAverages.length
      )
    : 0;

  return {
    subjectAverages,
    termAverages,
    annualAverage,
    hasIncompleteData: gaps.length > 0,
    gaps,
  };
}

module.exports = { round, computeStudentAverages };
