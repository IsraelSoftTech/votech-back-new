const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('user_activities', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    activity_type: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    activity_description: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    entity_type: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    entity_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    entity_name: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: true
    },
    user_agent: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'user_activities',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "idx_user_activities_activity_type",
        fields: [
          { name: "activity_type" },
        ]
      },
      {
        name: "idx_user_activities_created_at",
        fields: [
          { name: "created_at" },
        ]
      },
      {
        name: "idx_user_activities_user_id",
        fields: [
          { name: "user_id" },
        ]
      },
      {
        name: "user_activities_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
