const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");
const app = express();

// 1. CONFIGURATION
const SHOP = process.env.SHOP_NAME;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));

// 2. DATABASE CONNECTION
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
  if (!data.access_token) throw new Error("Shopify Auth Failed");
  
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
  return cachedToken;
}

// 3. ROUTES

// HOME REDIRECT
app.get("/", (req, res) => {
  res.redirect("/orders");
});

// MAIN ORDERS VIEW
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
        body { font-family: -apple-system, sans-serif; background: var(--bg); padding: 20px; margin: 0; }
        .header { background: white; padding: 20px; border-bottom: 1px solid #ddd; position: sticky; top: 0; display: flex; justify-content: space-between; align-items: center; z-index: 10; }
        .card { background: white; border-radius: 10px; padding: 15px; margin: 15px 0; border: 1px solid #ddd; display: flex; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .order-info { flex-grow: 1; margin-left: 15px; }
        .sku-tag { background: #eee; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 5px; }
        .batch-btn { background: var(--primary); color: white; border: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; cursor: pointer; }
        input[type="checkbox"] { transform: scale(1.5); cursor: pointer; }
        .nav-links { padding: 10px 0; }
      </style>

      <div class="header">
        <h1>📦 Picklist</h1>
        <div class="nav-links"><a href="/batches">View Saved Batches</a></div>
      </div>

      <form action="/create-batch" method="POST" style="max-width: 800px; margin: auto;">
        <div style="text-align: right; padding: 10px 0;">
            <button type="submit" class="batch-btn">Create Batch Picklist</button>
        </div>

        ${orders.length === 0 ? '<p>No unfulfilled orders found.</p>' : orders.map(order => `
          <div class="card">
            <input type="checkbox" name="selected_orders" value="${order.id}">
            <div class="order-info">
              <strong>Order ${order.name}</strong>
              <div style="margin-top:5px;">
                ${order.line_items.map(i => `<span class="sku-tag">${i.sku || 'No SKU'}</span>`).join('')}
              </div>
            </div>
            <div style="text-align:right">
                <div style="font-size: 1.2rem; font-weight: bold;">${order.line_items.length}</div>
                <div style="font-size: 0.7rem; color: #666;">ITEMS</div>
            </div>
          </div>
        `).join('')}
      </form>
    `;
    res.send(html);
  } catch (err) {
    res.status(500).send("Error loading orders: " + err.message);
  }
});

// CREATE BATCH (Modified to create table on-demand and show detailed error)
app.post("/create-batch", async (req, res) => {
  const selectedIds = req.body.selected_orders;
  if (!selectedIds) return res.send("<script>alert('Select orders first!'); window.history.back();</script>");

  const orderIdsString = Array.isArray(selectedIds) ? selectedIds.join(",") : selectedIds;
  const batchName = `Batch #${Math.floor(1000 + Math.random() * 9000)}`;

  try {
    // 1. Create table on demand in case it wasn't made on startup
    await pool.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id SERIAL PRIMARY KEY,
        name TEXT,
        order_ids TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Insert the data
    await pool.query(
      "INSERT INTO batches (name, order_ids) VALUES ($1, $2)",
      [batchName, orderIdsString]
    );
    res.redirect("/batches");
  } catch (err) {
    console.error("Save Error Details:", err);
    res.status(500).send(`
      <div style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h1 style="color: #d9534f;">❌ Database Save Error</h1>
        <p>Your app couldn't save the batch to PostgreSQL.</p>
        <div style="background: #f8f9fa; border: 1px solid #ddd; padding: 15px; display: inline-block; text-align: left; margin: 20px 0; border-radius: 5px;">
          <strong>Error Message:</strong> ${err.message || 'Unknown error'}<br>
          <strong>Error Code:</strong> ${err.code || 'None'}<br>
          <strong>Detail:</strong> ${err.detail || 'None'}
        </div>
        <br><br>
        <a href="/orders" style="background: #008060; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none;">Go Back</a>
      </div>
    `);
  }
});

// VIEW BATCHES
app.get("/batches", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM batches ORDER BY created_at DESC");
    
    let html = `
      <style>
        body { font-family: sans-serif; padding: 30px; background: #f6f6f7; }
        .batch-card { background: white; padding: 20px; border-radius: 8px; border: 1px solid #ddd; margin-bottom: 15px; }
        .btn { display: inline-block; padding: 8px 15px; border-radius: 5px; text-decoration: none; font-size: 14px; margin-top: 10px; }
        .btn-blue { background: #007ace; color: white; }
      </style>
      <h1>📜 Saved Batches</h1>
      <a href="/orders">← Back to Selection</a><br><br>
    `;
    
    result.rows.forEach(batch => {
      html += `
        <div class="batch-card">
          <strong>${batch.name}</strong><br>
          <small>Orders: ${batch.order_ids}</small><br>
          <a href="#" class="btn btn-blue" onclick="alert('PDF Generator coming in next update!')">Download PDF</a>
        </div>
      `;
    });
    
    res.send(html);
  } catch (err) {
    res.status(500).send("Error loading batches: " + err.message);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`App running on port ${PORT}`);
});
