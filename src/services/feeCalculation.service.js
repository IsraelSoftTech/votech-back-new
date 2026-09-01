"use strict";

const FEE_TYPES = ["Registration", "Bus", "Tuition", "Internship", "Remedial", "PTA"];

function parseFeeAmount(value) {
  if (value == null || value === "") return 0;
  const n = parseFloat(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function computeBaseFee(student) {
  return FEE_TYPES.reduce(
    (sum, type) => sum + parseFeeAmount(student[`${type.toLowerCase()}_fee`]),
    0
  );
}

function computePerTypeBalances(student, feeMap = {}) {
  return {
    Registration: Math.max(
      0,
      parseFeeAmount(student.registration_fee) - (feeMap.Registration || 0)
    ),
    Bus: Math.max(0, parseFeeAmount(student.bus_fee) - (feeMap.Bus || 0)),
    Internship: Math.max(
      0,
      parseFeeAmount(student.internship_fee) - (feeMap.Internship || 0)
    ),
    Remedial: Math.max(
      0,
      parseFeeAmount(student.remedial_fee) - (feeMap.Remedial || 0)
    ),
    Tuition: Math.max(
      0,
      parseFeeAmount(student.tuition_fee) - (feeMap.Tuition || 0)
    ),
    PTA: Math.max(0, parseFeeAmount(student.pta_fee) - (feeMap.PTA || 0)),
  };
}

/**
 * amount_due = base_fee - student_discount - payments_made (at summary level)
 */
function computeFeeSummary(student, feeMap = {}, discountAmount = 0, discountMeta = {}) {
  const baseFee = computeBaseFee(student);
  const rawDiscount = Math.max(0, parseFeeAmount(discountAmount));
  const effectiveDiscount = Math.min(rawDiscount, baseFee);
  const netExpected = Math.max(0, baseFee - effectiveDiscount);

  const balance = computePerTypeBalances(student, feeMap);
  const totalPaid = FEE_TYPES.reduce((sum, type) => {
    const expected = parseFeeAmount(student[`${type.toLowerCase()}_fee`]);
    const owed = balance[type] || 0;
    return sum + Math.max(0, expected - owed);
  }, 0);

  const totalBalance = Math.max(0, netExpected - totalPaid);

  return {
    baseFee,
    discountAmount: effectiveDiscount,
    discountReason: discountMeta.reason || null,
    discountId: discountMeta.id || null,
    netExpected,
    totalPaid,
    totalBalance,
    balance,
  };
}

/**
 * Single source of truth for fee payment status (Point 4D).
 * status: paid | partial | unpaid | overpaid | no_fees
 */
function deriveFeeStatus({ netExpected, totalPaid, totalBalance, baseFee }) {
  const due = parseFeeAmount(netExpected);
  const paid = parseFeeAmount(totalPaid);
  const balance = parseFeeAmount(totalBalance);
  const base = parseFeeAmount(baseFee);

  if (base <= 0) return "no_fees";
  if (paid > due && paid > 0) return "overpaid";
  if (balance <= 0 && paid > 0) return "paid";
  if (paid > 0 && balance > 0) return "partial";
  if (paid <= 0 && due > 0) return "unpaid";
  if (due <= 0) return "paid";
  return "unpaid";
}

function withFeeStatus(summary) {
  const status = deriveFeeStatus(summary);
  return { ...summary, status };
}

function buildFeeStatusResult(summary) {
  const enriched = withFeeStatus(summary);
  return {
    total_due: enriched.netExpected,
    total_paid: enriched.totalPaid,
    balance: enriched.totalBalance,
    base_fee: enriched.baseFee,
    discount_amount: enriched.discountAmount,
    status: enriched.status,
  };
}

function buildStudentFeePayload(student, feeMap, discountRow) {
  const discountAmount = discountRow ? parseFeeAmount(discountRow.discount_amount) : 0;
  const summary = withFeeStatus(
    computeFeeSummary(student, feeMap, discountAmount, {
      reason: discountRow?.reason,
      id: discountRow?.id,
    })
  );
  return {
    student,
    balance: summary.balance,
    summary: {
      baseFee: summary.baseFee,
      discountAmount: summary.discountAmount,
      discountReason: summary.discountReason,
      discountId: summary.discountId,
      netExpected: summary.netExpected,
      totalPaid: summary.totalPaid,
      totalBalance: summary.totalBalance,
      status: summary.status,
    },
  };
}

module.exports = {
  FEE_TYPES,
  parseFeeAmount,
  computeBaseFee,
  computePerTypeBalances,
  computeFeeSummary,
  deriveFeeStatus,
  withFeeStatus,
  buildFeeStatusResult,
  buildStudentFeePayload,
};
