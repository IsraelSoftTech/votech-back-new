require("dotenv").config();

/** True when the app should use DATABASE_URL_LOCAL instead of DATABASE_URL. */
function useLocalDatabase() {
  const flag = process.env.USE_LOCAL_DB;
  if (flag === "1" || flag === "true") return true;
  const env = process.env.NODE_ENV || "development";
  return env === "desktop" || env === "development";
}

function getDatabaseUrl() {
  const local = useLocalDatabase();
  const url = local ? process.env.DATABASE_URL_LOCAL : process.env.DATABASE_URL;
  return { url, local };
}

function parsePoolInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Max connections per pool (pg + Sequelize each use this). */
function getPoolMax() {
  if (process.env.DB_POOL_MAX != null && process.env.DB_POOL_MAX !== "") {
    return parsePoolInt(process.env.DB_POOL_MAX, 5);
  }
  return useLocalDatabase() ? 5 : 20;
}

function getPoolMin() {
  if (process.env.DB_POOL_MIN != null && process.env.DB_POOL_MIN !== "") {
    return Math.max(0, parsePoolInt(process.env.DB_POOL_MIN, 0));
  }
  return useLocalDatabase() ? 0 : 2;
}

function getEnvironmentLabel(local) {
  return local ? "LOCAL (Desktop/Dev)" : "REMOTE (Production DB)";
}

function maskDatabaseUrl(url) {
  if (!url) return "UNDEFINED";
  return url.replace(/:[^:@]+@/, ":****@");
}

module.exports = {
  useLocalDatabase,
  getDatabaseUrl,
  getPoolMax,
  getPoolMin,
  getEnvironmentLabel,
  maskDatabaseUrl,
};
