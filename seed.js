// 1. Import our tools
// 'dotenv' loads our .env.local file
require('dotenv').config({ path: '.env.local' });
// 'neon' is the database driver
const { neon } = require('@neondatabase/serverless');

// 2. Get the database connection string from the environment
const connectionString = process.env.DATABASE_URL;

// 3. Check if the connection string exists (critical check)
if (!connectionString) {
  throw new Error('DATABASE_URL is not set in your .env.local file');
}

// 4. Create a new SQL client
const sql = neon(connectionString);

// 5. This is the main "async" function that does the work
async function createTable() {
  console.log('Connecting to database...');
  try {
    // 6. Execute the query using the new "tagged template" syntax
    await sql`
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL UNIQUE,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    console.log('✅ Success! "posts" table created or already exists.');
  } catch (error) {
    console.error('❌ Error creating table:', error);
  }
}

// 7. Run the function
createTable();