const { Pool } = require('pg');

// Set up PostgreSQL connection pooling
const pool = new Pool({
    user: 'your_username',
    host: 'localhost',
    database: 'your_database',
    password: 'your_password',
    port: 5432,
});

// Function to initialize tables
async function initTables() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS your_table_name (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );`);
    } finally {
        client.release();
    }
}

// Graceful shutdown handling
process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server');
    await pool.end();
    console.log('Pool has ended');
    process.exit(0);
});

module.exports = { pool, initTables };