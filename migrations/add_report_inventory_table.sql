-- Report Inventory table for Inventory management under Reports
CREATE TABLE IF NOT EXISTS report_inventory (
  id SERIAL PRIMARY KEY,
  item_name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(20) NOT NULL CHECK (category IN ('income', 'expenditure')),
  uom VARCHAR(50) NOT NULL CHECK (uom IN ('Pieces', 'Kg', 'Liters', 'Cartons')),
  unit_cost_price NUMERIC(12,2) NOT NULL,
  depreciation_rate NUMERIC(5,2),
  supplier VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
