const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('id_cards', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    student_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    card_number: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    issued_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    }
  }, {
    sequelize,
    tableName: 'id_cards',
    schema: 'public',
    timestamps: false,
    indexes: [
      {
        name: "id_cards_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
