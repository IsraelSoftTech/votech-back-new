"use strict";

// Overall-average floor for "Failed" is a fixed 10/20 (checklist item 15),
// distinct from `pass_mark`, which is the admin-configurable threshold used
// only for per-subject compulsory-pass checks, and from `min_average`,
// the admin-configurable threshold for a full, unconditional "Promoted".
const FAILED_AVERAGE_FLOOR = 10;

/**
 * @param {number} overallAverage
 * @param {Map<number, {annual:number|null, category:string}>} subjectAverages
 * @param {{
 *   min_average:number, pass_mark:number,
 *   compulsory_general_subject_ids:number[],
 *   compulsory_professional_subject_ids:number[],
 *   min_professional_subjects_passed:number,
 * }} requirement
 */
function decidePromotion(overallAverage, subjectAverages, requirement) {
  if (overallAverage < FAILED_AVERAGE_FLOOR) {
    return {
      decision: "failed",
      reasons: [`Overall average ${overallAverage} is below the 10/20 floor`],
    };
  }

  const passMark = requirement.pass_mark;
  const subjectName = (id) => subjectAverages.get(id)?.name || `Subject #${id}`;

  const passed = (id) => {
    const avg = subjectAverages.get(id);
    return !!avg && avg.annual !== null && avg.annual >= passMark;
  };

  const failedGeneral = requirement.compulsory_general_subject_ids.filter(
    (id) => !passed(id)
  );
  const failedProfessional =
    requirement.compulsory_professional_subject_ids.filter((id) => !passed(id));

  const professionalEntries = [...subjectAverages.entries()].filter(
    ([, avg]) => avg.category === "professional"
  );
  const professionalPassedCount = professionalEntries.filter(
    ([, avg]) => avg.annual !== null && avg.annual >= passMark
  ).length;

  const meetsMinAverage = overallAverage >= requirement.min_average;
  const meetsCompulsory =
    failedGeneral.length === 0 && failedProfessional.length === 0;
  const meetsMinProfessionalCount =
    professionalPassedCount >= requirement.min_professional_subjects_passed;

  const reasons = [];
  if (!meetsMinAverage) {
    reasons.push(
      `Average ${overallAverage} is below the required minimum of ${requirement.min_average}`
    );
  }
  if (failedGeneral.length) {
    reasons.push(
      `Did not pass compulsory General subject(s): ${failedGeneral
        .map(subjectName)
        .join(", ")}`
    );
  }
  if (failedProfessional.length) {
    reasons.push(
      `Did not pass compulsory Professional subject(s): ${failedProfessional
        .map(subjectName)
        .join(", ")}`
    );
  }
  if (!meetsMinProfessionalCount) {
    reasons.push(
      `Only passed ${professionalPassedCount} of the required ${requirement.min_professional_subjects_passed} Professional subjects`
    );
  }

  if (meetsMinAverage && meetsCompulsory && meetsMinProfessionalCount) {
    return { decision: "promoted", reasons: [] };
  }

  return { decision: "promoted_on_condition", reasons };
}

module.exports = { decidePromotion, FAILED_AVERAGE_FLOOR };
