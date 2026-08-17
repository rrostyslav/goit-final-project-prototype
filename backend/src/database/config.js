// Config consumed by sequelize-cli (migrations/seeders run outside Nest's DI,
// so this file loads the environment the same way backend/src/main.ts does).
//
// Node's process.loadEnvFile() never overwrites a variable already present in
// process.env, so a real environment variable always wins over the .env file.
try {
  process.loadEnvFile()
} catch {
  // No .env file present — rely on env vars already set in the process.
}

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set')
}

module.exports = {
  development: {
    url: databaseUrl,
    dialect: 'postgres',
  },
  production: {
    url: databaseUrl,
    dialect: 'postgres',
  },
}
