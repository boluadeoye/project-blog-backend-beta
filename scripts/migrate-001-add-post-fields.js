// backend/scripts/migrate-001-add-post-fields.js
require("dotenv").config({ path: ".env.local" });
const { neon } = require("@neondatabase/serverless");

async function main() {
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL is not set in .env.local");
  const sql = neon(conn);

  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS type VARCHAR(50) NOT NULL DEFAULT 'article'`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::text[]`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT true`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`;

  console.log("✅ posts: added type, tags, meta, published, updated_at");
}
main().catch((e) => { console.error(e); process.exit(1); });
