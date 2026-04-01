const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const SHOP = process.env.SHOP_NAME;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= DATABASE =================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize Database Table on Startup
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id SERIAL PRIMARY KEY,
        name TEXT,
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Database Table Ready");
  } catch (err) {
    console.error("❌ DB Initialization Error:", err.message);
  }
}
initDB();

// ================= TOKEN CACHE =================
let cachedToken = null;
let tokenExpiry = 0;

// ================= GET TOKEN =================
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const response = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials"
    })
  });

  const data = await response.json();

  if (!data.access_token) {
    console.error("Shopify Auth Error:", data);
    throw new Error("Token generation failed. Check SHOP_NAME and Secrets.");
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3500 * 1000; // 5 minute buffer

  return cachedToken;
}

// ================= FETCH ORDERS =================
async function getOrders() {
  const token = await getAccessToken();
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled&limit=50`,
    { headers: { "X-Shopify-Access-Token": token } }
  );

  const data = await response.json();
  return data.orders || [];
}

async function getOrdersByIds(ids) {
  const token = await getAccessToken();
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?ids=${ids.join(",")}`,
    { headers: { "X-Shopify-Access-Token": token } }
  );

  const data = await response.json();
  return data.orders || [];
}

// ================= ROUTES =================

app.get("/", (req, res) => res.redirect("/orders"));

// ORDERS PAGE
app.get("/orders", async (req, res) => {
  try {
    const orders = await getOrders();

    let html = `
    <style>
      body { font-family:sans-serif; background:#f6f6f7; padding:20px; }
      .card { background:white; padding:15px; margin:10px 0; border-radius:10px; display:flex; align-items:center; }
      .btn { background:#008060; color:white; padding:10px 20px; border:none; border-radius:8px; cursor:pointer; }
      .sku { background:#eee; padding:3px 6px; margin-right:5px; border-radius:4px; font-size:11px; }
    </style>
    <h1>📦 Picklist</h1>
    <a href="/batches">View Saved Picklists</a><br/><br/>
    <form method="POST" action="/create-batch">
    <button class="btn">Create Picklist</button>
    `;

    if (orders.length === 0) html += "<p>No unfulfilled orders found.</p>";

    orders.forEach(order => {
      html += `
      <div class="card">
        <input type="checkbox" name="orders" value="${order.id}">
        <div style="margin-left:10px;">
          <strong>${order.name}</strong><br/>
          ${order.line_items.map(i => `<span class="sku">${i.sku || "NO-SKU"}</span>`).join("")}
        </div>
        <div style="margin-left:auto;">${order.line_items.length} ITEMS</div>
      </div>`;
    });

    html += `</form>`;
    res.send(html);
  } catch (err) {
    res.status(500).send("Error loading orders: " + err.message);
  }
});

// CREATE BATCH
app.post("/create-batch", async (req, res) => {
  try {
    let orderIds = req.body.orders;
    if (!orderIds) return res.send("<script>alert('Select orders first'); window.history.back();</script>");
    if (!Array.isArray(orderIds)) orderIds = [orderIds];

    const fullOrders = await getOrdersByIds(orderIds);
    const batchName = `Batch-${new Date().toLocaleString()}`;

    await pool.query(
      "INSERT INTO batches (name, data) VALUES ($1, $2)",
      [batchName, JSON.stringify(fullOrders)]
    );

    res.redirect("/batches");
  } catch (err) {
    console.error("Insert Error:", err);
    res.status(500).send("DB Error: " + err.message);
  }
});

// VIEW ALL BATCHES
app.get("/batches", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM batches ORDER BY created_at DESC");
    let html = `<h1>Saved Picklists</h1><a href="/orders">Back to Orders</a><br/><br/>`;

    result.rows.forEach(batch => {
      html += `<div><strong>${batch.name}</strong> - <a href="/batch/${batch.id}">View Details</a></div><br/>`;
    });
    res.send(html);
  } catch (err) {
    res.status(500).send("Database Error: " + err.message);
  }
});

// VIEW SINGLE PICKLIST
app.get("/batch/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM batches WHERE id=$1", [req.params.id]);
    if (result.rows.length === 0) return res.send("Not found");

    const orders = result.rows[0].data;
    const skuMap = {};

    orders.forEach(order => {
      order.line_items.forEach(item => {
        const sku = item.sku || "NO-SKU";
        if (!skuMap[sku]) skuMap[sku] = { name: item.name, qty: 0 };
        skuMap[sku].qty += item.quantity;
      });
    });

    let html = `<h1>Picklist Details</h1><a href="/batches">Back</a><table border="1" cellpadding="10" style="border-collapse:collapse; margin-top:20px;">`;
    html += `<tr><th>SKU</th><th>Product</th><th>Total Qty</th></tr>`;

    Object.keys(skuMap).forEach(sku => {
      html += `<tr><td>${sku}</td><td>${skuMap[sku].name}</td><td>${skuMap[sku].qty}</td></tr>`;
    });

    html += `</table>`;
    res.send(html);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server active on port " + PORT);
});
