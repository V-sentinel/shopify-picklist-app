const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= DATABASE =================
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing!");
} else {
  console.log("✅ DATABASE_URL found");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10
});    
// ================= INIT DB WITH RETRY =================
async function initDB(retries = 5) {
  try {
    const client = await pool.connect();

    await client.query(`
      CREATE TABLE IF NOT EXISTS test_data (
        id SERIAL PRIMARY KEY,
        value TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    client.release();

    console.log("✅ Database connected & table ready");

  } catch (err) {
    console.error("❌ DB INIT ERROR:", err.message);

    if (retries > 0) {
      console.log(`🔄 Retrying DB connection... (${retries} left)`);
      await new Promise(res => setTimeout(res, 2000));
      return initDB(retries - 1);
    } else {
      console.error("❌ Could not connect to DB after retries");
    }
  }
}

// ================= START SERVER =================
async function startServer() {
  await initDB();

  app.listen(PORT, "0.0.0.0", () => {
    console.log("🚀 App running on port " + PORT);
  });
}

startServer();

// ================= UI =================
app.get("/", (req, res) => {
  res.send(`
    <h1>Simple Data App</h1>
    <form method="POST" action="/save">
      <input type="text" name="value" placeholder="Enter something (e.g. 123)" />
      <button type="submit">Save</button>
    </form>
    <br/>
    <a href="/data">View Data</a>
  `);
});

// ================= SAVE DATA =================
app.post("/save", async (req, res) => {
  try {
    const value = req.body.value;

    if (!value) {
      return res.send("❌ Please enter something");
    }

    console.log("➡️ Saving value:", value);

    const result = await pool.query(
      "INSERT INTO test_data (value) VALUES ($1) RETURNING *",
      [value]
    );

    console.log("✅ Saved:", result.rows[0]);

    res.send(`
      <h2>✅ Saved Successfully</h2>
      <p>Value: ${result.rows[0].value}</p>
      <a href="/">Go Back</a>
    `);

  } catch (err) {
    console.error("❌ SAVE ERROR:", err);

    res.send(`
      <h2 style="color:red;">DATABASE ERROR</h2>
      <pre>${err.stack}</pre>
      <a href="/">Go Back</a>
    `);
  }
});

// ================= VIEW DATA =================
app.get("/data", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM test_data ORDER BY id DESC");

    let html = "<h1>Saved Data</h1><a href='/'>Back</a><br><br>";

    result.rows.forEach(row => {
      html += `<div>ID: ${row.id} | Value: ${row.value}</div>`;
    });

    res.send(html);

  } catch (err) {
    console.error("❌ FETCH ERROR:", err);

    res.send(`
      <h2 style="color:red;">FETCH ERROR</h2>
      <pre>${err.stack}</pre>
    `);
  }
});
