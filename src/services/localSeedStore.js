const fs = require('fs');
const path = require('path');

const seedPath = path.join(__dirname, '..', '..', 'sample-data', 'seed.sql');

let cache = null;

function splitRows(valuesSql) {
  const rows = [];
  let inQuote = false;
  let depth = 0;
  let current = '';

  for (let i = 0; i < valuesSql.length; i += 1) {
    const char = valuesSql[i];
    const next = valuesSql[i + 1];

    if (char === "'" && next === "'") {
      current += char + next;
      i += 1;
      continue;
    }

    if (char === "'") {
      inQuote = !inQuote;
    }

    if (!inQuote && char === '(') {
      depth += 1;
      if (depth === 1) continue;
    }

    if (!inQuote && char === ')') {
      depth -= 1;
      if (depth === 0) {
        rows.push(current.trim());
        current = '';
        continue;
      }
    }

    if (depth > 0) current += char;
  }

  return rows;
}

function splitValues(rowSql) {
  const values = [];
  let inQuote = false;
  let current = '';

  for (let i = 0; i < rowSql.length; i += 1) {
    const char = rowSql[i];
    const next = rowSql[i + 1];

    if (inQuote && char === "'" && next === "'") {
      current += "'";
      i += 1;
      continue;
    }

    if (char === "'") {
      inQuote = !inQuote;
      continue;
    }

    if (!inQuote && char === ',') {
      values.push(parseValue(current));
      current = '';
      continue;
    }

    current += char;
  }

  values.push(parseValue(current));
  return values;
}

function parseValue(value) {
  const trimmed = value.trim();
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  if (/^null$/i.test(trimmed)) return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseInsert(sql, tableName) {
  const pattern = new RegExp(
    `INSERT\\s+INTO\\s+${tableName}\\s*\\(([^)]+)\\)\\s*VALUES\\s*([\\s\\S]*?)(?:ON\\s+CONFLICT|;)`,
    'i'
  );
  const match = sql.match(pattern);
  if (!match) return [];

  const columns = match[1].split(',').map((column) => column.trim());
  return splitRows(match[2]).map((rowSql) => {
    const values = splitValues(rowSql);
    return columns.reduce((row, column, index) => {
      row[column] = values[index];
      return row;
    }, {});
  });
}

function loadSeedData() {
  if (cache) return cache;

  const sql = fs.readFileSync(seedPath, 'utf8');
  const employees = parseInsert(sql, 'employees');
  const crops = parseInsert(sql, 'crops');
  const farms = parseInsert(sql, 'farms');
  const farmMemberships = parseInsert(sql, 'farm_memberships').map((membership) => ({
    id: `seed-${membership.employee_id}-${membership.farm_id}`,
    ...membership,
  }));
  const farmPlots = parseInsert(sql, 'farm_plots');

  cache = {
    employees,
    crops,
    farms,
    farmMemberships,
    farmPlots,
  };

  return cache;
}

function getFarms() {
  const { farms, farmMemberships, employees } = loadSeedData();

  return farms.map((farm) => {
    const membership = farmMemberships.find((item) => item.farm_id === farm.farm_id);
    const employee = employees.find((item) => item.employee_id === membership?.employee_id);

    return {
      ...farm,
      employee_id: employee?.employee_id || null,
      employee_name: employee?.employee_name || null,
      employee_code: employee?.employee_code || null,
    };
  }).sort((a, b) => a.farm_code.localeCompare(b.farm_code));
}

function getUnassignedFarms() {
  const { farms, farmMemberships } = loadSeedData();
  const assignedFarmIds = new Set(farmMemberships.map((membership) => membership.farm_id));

  return farms
    .filter((farm) => farm.active && !assignedFarmIds.has(farm.farm_id))
    .sort((a, b) => a.farm_name.localeCompare(b.farm_name));
}

function getPlots(farmId) {
  const { farmPlots, farmMemberships, employees, crops } = loadSeedData();
  const membership = farmMemberships.find((item) => item.farm_id === farmId);
  const employee = employees.find((item) => item.employee_id === membership?.employee_id);

  return farmPlots
    .filter((plot) => plot.farm_id === farmId)
    .map((plot) => {
      const crop = crops.find((item) => item.crop_id === plot.current_crop_id);
      return {
        ...plot,
        crops: crop ? { crop_name: crop.crop_name } : null,
        assigned_employee: employee?.employee_name || null,
      };
    });
}

function getCrops() {
  return [...loadSeedData().crops].sort((a, b) => a.crop_name.localeCompare(b.crop_name));
}

function getEmployees() {
  return [...loadSeedData().employees].sort((a, b) => a.employee_name.localeCompare(b.employee_name));
}

function getEmployeeFarms(employeeId) {
  const { farmMemberships, farms } = loadSeedData();

  return farmMemberships
    .filter((membership) => membership.employee_id === employeeId)
    .map((membership) => {
      const farm = farms.find((item) => item.farm_id === membership.farm_id);
      return {
        id: membership.id,
        role: membership.role,
        farms: farm ? {
          farm_id: farm.farm_id,
          farm_code: farm.farm_code,
          farm_name: farm.farm_name,
        } : null,
      };
    });
}

module.exports = {
  getFarms,
  getUnassignedFarms,
  getPlots,
  getCrops,
  getEmployees,
  getEmployeeFarms,
};
