const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('timetables', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    class_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'classes',
        key: 'id'
      },
      unique: "timetables_class_id_key"
    },
    data: {
      type: DataTypes.JSONB,
      allowNull: false
    }
  }, {
    sequelize,
    tableName: 'timetables',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "timetables_class_id_key",
        unique: true,
        fields: [
          { name: "class_id" },
        ]
      },
      {
        name: "timetables_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
