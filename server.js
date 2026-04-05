const express = require("express");
const { Pool } = require("pg");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= CONFIG =================
const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

// ================= DATABASE =================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= INIT DB =================
const MAX_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 1000;

async function initDB(attempt = 1) {
  try {
    console.log(`🔄 DB connection attempt ${attempt} of ${MAX_RETRIES}...`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS picklists (
        id SERIAL PRIMARY KEY,
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Picklist table ready");
  } catch (err) {
    console.error(`❌ DB connection attempt ${attempt} failed: ${err.message}`);
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`⏳ Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return initDB(attempt + 1);
    }
    console.error("🚨 All DB connection attempts failed. The app will continue running but database operations will fail until the connection is restored.");
  }
}

// ================= HEALTH CHECK =================
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", db: "connected" });
  } catch (err) {
    console.error("Health check DB error:", err.message);
    res.status(503).json({ status: "degraded", db: "unavailable", error: err.message });
  }
});

// ================= HOME =================
app.get("/", async (req, res) => {
  res.send(`
    <h1>Picklist App</h1>
    <a href="/orders">View Orders</a><br><br>
    <a href="/picklists">View Picklists</a>
  `);
});

// ================= FETCH ORDERS =================
app.get("/orders", async (req, res) => {
  try {
    const response = await fetch(
      `https://${SHOP}/admin/api/2024-01/orders.json?status=open`,
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();

    let html = "<h1>Orders</h1><a href='/'>Back</a><br><br>";

    data.orders.forEach(order => {
      html += `
        <div style="border:1px solid #ccc; padding:10px; margin:10px;">
          <b>Order #${order.order_number}</b><br>
          Items: ${order.line_items.length}<br>
          <a href="/create-picklist/${order.id}">Create Picklist</a>
        </div>
      `;
    });

    res.send(html);

  } catch (err) {
    res.send("❌ Error fetching orders " + err.message);
  }
});

// ================= CREATE PICKLIST =================
app.get("/create-picklist/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;

    const response = await fetch(
      `https://${SHOP}/admin/api/2024-01/orders/${orderId}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();
    const order = data.order;

    // Save picklist in DB
    const result = await pool.query(
      "INSERT INTO picklists (data) VALUES ($1) RETURNING *",
      [order]
    );

    res.send(`
      <h2>✅ Picklist Created</h2>
      <a href="/picklists">View Picklists</a>
    `);

  } catch (err) {
    res.send("❌ Error creating picklist " + err.message);
  }
});

// ================= VIEW PICKLISTS =================
app.get("/picklists", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM picklists ORDER BY id DESC"
    );

    let html = "<h1>Picklists</h1><a href='/'>Back</a><br><br>";

    result.rows.forEach(row => {
      const order = row.data;

      html += `
        <div style="border:1px solid black; margin:10px; padding:10px;">
          <b>Order #${order.order_number}</b><br>
          ${order.line_items.map(item => `
            <div>
              ${item.title} - Qty: ${item.quantity}
            </div>
          `).join("")}
        </div>
      `;
    });

    res.send(html);
  } catch (err) {
    console.error("Error fetching picklists:", err.message);
    res.status(503).send("❌ Database unavailable — unable to load picklists. Please try again later.");
  }
});

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 Picklist app running on port " + PORT);
  initDB();
});
