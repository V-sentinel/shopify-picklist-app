const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= DATABASE =================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create table on start
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS test_data (
        id SERIAL PRIMARY KEY,
        value TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Table ready");
  } catch (err) {
    console.error("❌ DB Error:", err);
  }
}
initDB();

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

    await pool.query(
      "INSERT INTO test_data (value) VALUES ($1)",
      [value]
    );

    res.send("✅ Saved successfully! <br><a href='/'>Go Back</a>");
  } catch (err) {
    console.error(err);
    res.send("❌ Error saving data");
  }
});

// ================= VIEW DATA =================
app.get("/data", async (req, res) => {
  const result = await pool.query("SELECT * FROM test_data ORDER BY id DESC");

  let html = "<h1>Saved Data</h1><a href='/'>Back</a><br><br>";

  result.rows.forEach(row => {
    html += `<div>ID: ${row.id} | Value: ${row.value}</div>`;
  });

  res.send(html);
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 App running on port " + PORT);
});
