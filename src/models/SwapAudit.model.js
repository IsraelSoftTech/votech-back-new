"use strict";

const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");
const AppError = require("../utils/AppError");
const { StatusCodes } = require("http-status-codes");

const VALID_DIRECTIONS = ["onsiteToOnline", "onlineToOnsite"];
const VALID_TARGET_MODES = ["online", "onsite"];
const VALID_STATUSES = [
  "in_progress",
  "complete",
  "complete_with_warnings",
  "failed",
  "rolled_back",
  "critical",
];

module.exports = (sequelizeInstance = sequelize) => {
  const SwapAudit = sequelizeInstance.define(
    "swap_audit",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      operation_id: {
        type: DataTypes.UUID,
        allowNull: false,
        validate: {
          isUUID: 4,
        },
      },
      direction: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: {
          isIn: [VALID_DIRECTIONS],
        },
      },
      target_mode: {
        type: DataTypes.STRING(10),
        allowNull: false,
        validate: {
          isIn: [VALID_TARGET_MODES],
        },
      },
      initiated_from: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Machine name",
      },
      started_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      completed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      duration_seconds: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
          min: 0,
        },
      },
      status: {
        type: DataTypes.STRING(30),
        allowNull: false,
        validate: {
          isIn: [VALID_STATUSES],
        },
      },
      warnings: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      source_dump_checksum: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      target_dump_checksum: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      source_row_counts: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      restored_row_counts: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "swap_audit",
      timestamps: false, // We manage created_at manually
      indexes: [
        { name: "idx_swap_audit_operation", fields: ["operation_id"] },
        { name: "idx_swap_audit_started", fields: ["started_at"] },
      ],
      hooks: {
        beforeCreate: async (audit, options) => {
          await SwapAudit.validateSwapAudit(audit);
        },
        beforeUpdate: async (audit, options) => {
          await SwapAudit.validateSwapAudit(audit, true);
        },
      },
    }
  );

  // ----- Associations -----
  //   SwapAudit.associate = (models) => {};

  // ----- Application-Level Validation -----
  SwapAudit.validateSwapAudit = async (data, partial = false) => {
    const errors = [];

    // Required fields validation
    const requiredFields = [
      "operation_id",
      "direction",
      "target_mode",
      "started_at",
      "status",
    ];

    for (const key of requiredFields) {
      if (!partial || key in data) {
        if (data[key] === undefined || data[key] === null || data[key] === "") {
          errors.push(`${key} is required`);
        }
      }
    }

    // UUID validation for operation_id
    if (data.operation_id) {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(data.operation_id)) {
        errors.push("operation_id must be a valid UUID");
      }
    }

    // Enum validation for direction
    if (data.direction && !VALID_DIRECTIONS.includes(data.direction)) {
      errors.push(`direction must be one of: ${VALID_DIRECTIONS.join(", ")}`);
    }

    // Enum validation for target_mode
    if (data.target_mode && !VALID_TARGET_MODES.includes(data.target_mode)) {
      errors.push(
        `target_mode must be one of: ${VALID_TARGET_MODES.join(", ")}`
      );
    }

    // Enum validation for status
    if (data.status && !VALID_STATUSES.includes(data.status)) {
      errors.push(`status must be one of: ${VALID_STATUSES.join(", ")}`);
    }

    // Duration validation
    if (data.duration_seconds !== undefined && data.duration_seconds !== null) {
      if (
        !Number.isInteger(data.duration_seconds) ||
        data.duration_seconds < 0
      ) {
        errors.push("duration_seconds must be a non-negative integer");
      }
    }

    // Checksum length validation
    if (data.source_dump_checksum && data.source_dump_checksum.length > 64) {
      errors.push("source_dump_checksum must be 64 characters or less");
    }
    if (data.target_dump_checksum && data.target_dump_checksum.length > 64) {
      errors.push("target_dump_checksum must be 64 characters or less");
    }

    // JSON validation for JSONB fields
    const jsonFields = ["warnings", "source_row_counts", "restored_row_counts"];
    for (const field of jsonFields) {
      if (data[field] !== undefined && data[field] !== null) {
        if (typeof data[field] !== "object") {
          errors.push(`${field} must be a valid JSON object or array`);
        }
      }
    }

    // Date validation: completed_at should be after started_at
    if (data.started_at && data.completed_at) {
      const startDate = new Date(data.started_at);
      const endDate = new Date(data.completed_at);
      if (endDate < startDate) {
        errors.push("completed_at must be after started_at");
      }
    }

    if (errors.length) {
      throw new AppError(errors.join("; "), StatusCodes.BAD_REQUEST);
    }
  };

  SwapAudit.findByOperationId = async (operationId) => {
    return await SwapAudit.findAll({
      where: { operation_id: operationId },
      order: [["started_at", "DESC"]],
    });
  };

  SwapAudit.findByDateRange = async (startDate, endDate, options = {}) => {
    const { Op } = require("sequelize");
    return await SwapAudit.findAll({
      where: {
        started_at: {
          [Op.between]: [startDate, endDate],
        },
        ...options.where,
      },
      order: [["started_at", "DESC"]],
      ...options,
    });
  };

  SwapAudit.findByStatus = async (status) => {
    return await SwapAudit.findAll({
      where: { status },
      order: [["started_at", "DESC"]],
    });
  };

  SwapAudit.getStats = async (options = {}) => {
    const { fn, col } = require("sequelize");
    return await SwapAudit.findAll({
      attributes: [
        "status",
        [fn("COUNT", col("id")), "count"],
        [fn("AVG", col("duration_seconds")), "avg_duration"],
      ],
      group: ["status"],
      ...options,
    });
  };

  return SwapAudit;
};
