"use strict";

const models = require("../models/index.model");
const { ChangeTypes, logChanges } = require("./logChanges.util");

const SWITCH_LOG_TABLE = "academic_year_switch_logs";

/**
 * Persist switch/reactivate row and mirror to change_logs (Step 13.1).
 */
async function recordAcademicYearSwitchLog(
  {
    from_year_id,
    to_year_id,
    action,
    performed_by,
    performed_at,
    reason,
    ip_address,
  },
  user,
  transaction
) {
  const row = await models.AcademicYearSwitchLog.create(
    {
      from_year_id,
      to_year_id,
      action,
      performed_by,
      performed_at,
      reason: reason || null,
      ip_address: ip_address || null,
    },
    { transaction }
  );

  const plain = row.get({ plain: true });

  await logChanges(
    SWITCH_LOG_TABLE,
    plain.id,
    ChangeTypes.create,
    user,
    {
      action: { after: plain.action },
      from_year_id: { after: plain.from_year_id },
      to_year_id: { after: plain.to_year_id },
      reason: plain.reason ? { after: plain.reason } : undefined,
      performed_by: { after: plain.performed_by },
      performed_at: { after: plain.performed_at },
    }
  );

  return row;
}

module.exports = { recordAcademicYearSwitchLog };
