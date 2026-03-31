const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg"); // Added Postgres
const app = express();

app.use(express.urlencoded({ extended: true })); // To read form data

const SHOP = process.env.SHOP_NAME;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const PORT = process.env.PORT || 3000;

// 1. DATABASE CONNECTION
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Setup Table (Runs once to ensure your DB is ready)
pool.query(`
  CREATE TABLE IF NOT EXISTS batches (
    id SERIAL PRIMARY KEY,
    name TEXT,
    order_ids TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`).catch(err => console.error("DB Setup Error:", err));

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const response = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`,
  });
  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
  return cachedToken;
}

// 2. MAIN ORDERS VIEW (Selection Mode)
app.get("/orders", async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(
      `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled&limit=50`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    const data = await response.json();
    const orders = data.orders || [];

    let html = `
      <style>
        :root { --primary: #008060; --bg: #f6f6f7; }
        body { font-family: sans-serif; background: var(--bg); padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; background: var(--bg); padding: 10px 0; z-index: 10; }
        .card { background: white; border-radius: 8px; padding: 15px; margin-bottom: 10px; border: 1px solid #ddd; display: flex; align-items: center; }
        .batch-btn { background: var(--primary); color: white; border: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; cursor: pointer; }
        .order-info { flex-grow: 1; margin-left: 15px; }
        .sku-list { font-size: 0.8rem; color: #666; }
      </style>

      <form action="/create-batch" method="POST">
        <div class="header">
          <h1>📦 Select Orders</h1>
          <button type="submit" class="batch-btn">Create Picklist from Selection</button>
        </div>

        ${orders.map(order => `
          <div class="card">
            <input type="checkbox" name="selected_orders" value="${order.id}" style="width:25px; height:25px;">
            <div class="order-info">
              <strong>Order ${order.name}</strong>
              <div class="sku-list">${order.line_items.map(i => i.sku || 'No SKU').join(', ')}</div>
            </div>
            <span>${order.line_items.length} items</span>
          </div>
        `).join('')}
      </form>
    `;
    res.send(html);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// 3. CREATE BATCH ROUTE (Saves to Postgres)
app.post("/create-batch", async (req, res) => {
  const selectedIds = req.body.selected_orders;
  if (!selectedIds) return res.send("No orders selected!");

  const orderIdsString = Array.isArray(selectedIds) ? selectedIds.join(",") : selectedIds;
  const batchName = `Batch #${Math.floor(Math.random() * 10000)}`;

  try {
    await pool.query(
      "INSERT INTO batches (name, order_ids) VALUES ($1, $2)",
      [batchName, orderIdsString]
    );
    res.redirect("/batches");
  } catch (err) {
    res.status(500).send("Database Error: " + err.message);
  }
});

// 4. VIEW SAVED BATCHES
app.get("/batches", async (req, res) => {
  const result = await pool.query("SELECT * FROM batches ORDER BY created_at DESC");
  let html = `<h1>📜 Saved Picklists</h1><a href="/orders">Back to Orders</a><br><br>`;
  
  result.rows.forEach(batch => {
    html += `
      <div style="background:white; padding:15px; border:1px solid #ddd; margin-bottom:10px; border-radius:8px;">
        <strong>${batch.name}</strong> - ${batch.order_ids.split(',').length} Orders
        <br><small>Created: ${batch.created_at.toLocaleString()}</small>
        <br><button disabled>Download PDF (Coming Soon)</button>
      </div>
    `;
  });
  res.send(html);
});

app.listen(PORT, '0.0.0.0', () => console.log(`Running on ${PORT}`));
