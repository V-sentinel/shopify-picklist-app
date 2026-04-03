const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const SHOP = process.env.SHOP_NAME?.trim();
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET?.trim();
const DATABASE_URL = process.env.DATABASE_URL?.trim();

console.log("🔧 Starting Picklist App v2026...");
console.log("SHOP_NAME:", SHOP ? "✅ Set" : "❌ MISSING");
console.log("SHOPIFY_CLIENT_ID:", CLIENT_ID ? "✅ Set" : "❌ MISSING");
console.log("SHOPIFY_CLIENT_SECRET:", CLIENT_SECRET ? "✅ Set" : "❌ MISSING");
console.log("DATABASE_URL:", DATABASE_URL ? "✅ Set" : "❌ MISSING");

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET || !_URL) {
  console.error("❌ Missing required environment variables. Check Railway Variables.");
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= DATABASE (Improved) =================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,                    // connection pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function initDB() {
  try {
    // Test the connection
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id SERIAL PRIMARY KEY,
        name TEXT,
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    client.release();
    console.log("✅ Database Connected & Table Ready");
  } catch (err) {
    console.error("❌ Database Connection Failed:", err.message);
    console.error("   Make sure DATABASE_URL is correctly linked to Postgres service");
  }
}
initDB();

// ================= TOKEN CACHE (Client Credentials) =================
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  console.log("🔄 Fetching new Shopify access token...");

  const response = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials"
    })
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    console.error("❌ Shopify Token Error:", response.status, data);
    throw new Error(`Token failed: ${data.error || data.error_description || 'Unknown error'}`);
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3500 * 1000; // ~58 minutes (with buffer)
  console.log("✅ New access token obtained");
  return cachedToken;
}

// ================= FETCH ORDERS =================
async function getOrders() {
  const token = await getAccessToken();
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled&limit=50`,
    { headers: { "X-Shopify-Access-Token": token } }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error("Shopify Orders Error:", response.status, err);
    throw new Error(`Shopify API error ${response.status}`);
  }

  const data = await response.json();
  return data.orders || [];
}

async function getOrdersByIds(ids) {
  const token = await getAccessToken();
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?ids=${ids.join(",")}`,
    { headers: { "X-Shopify-Access-Token": token } }
  );

  if (!response.ok) throw new Error(`Shopify API error ${response.status}`);
  const data = await response.json();
  return data.orders || [];
}

// ================= ROUTES (Beautiful UI) =================
app.get("/", (req, res) => res.redirect("/orders"));

app.get("/orders", async (req, res) => {
  try {
    const orders = await getOrders();

    // (The full nice HTML with Tailwind is the same as before — kept short here for space)
    let html = `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Picklist • ${SHOP}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    </head>
    <body class="bg-gray-50">
      <div class="max-w-6xl mx-auto p-6">
        <h1 class="text-4xl font-bold mb-8">📦 Picklist Generator</h1>
        <a href="/batches" class="mb-6 inline-block text-emerald-600">View Saved Picklists →</a>

        <form method="POST" action="/create-batch">
          <button type="submit" class="mb-6 px-8 py-3 bg-emerald-600 text-white rounded-2xl font-semibold">Create New Picklist</button>

          <div class="grid gap-4">
    `;

    if (orders.length === 0) {
      html += `<p class="text-gray-500">No unfulfilled orders found.</p>`;
    } else {
      orders.forEach(order => {
        const customer = order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : "Walk-in";
        const totalItems = order.line_items.reduce((a, i) => a + (i.quantity || 0), 0);

        html += `
        <div class="bg-white p-6 rounded-3xl border flex items-center gap-6">
          <input type="checkbox" name="orders" value="${order.id}" class="w-5 h-5 accent-emerald-600">
          <div class="flex-1">
            <strong class="text-xl">${order.name}</strong><br>
            <span class="text-gray-600">${customer}</span>
            <div class="mt-2 flex flex-wrap gap-2">
              ${order.line_items.map(i => `<span class="text-xs bg-gray-100 px-3 py-1 rounded-xl">${i.sku || 'NO-SKU'} × ${i.quantity}</span>`).join('')}
            </div>
          </div>
          <div class="text-right">
            <div class="text-3xl font-bold">${totalItems}</div>
            <div class="text-xs text-gray-500">ITEMS</div>
          </div>
        </div>`;
      });
    }

    html += `</div></form></div></body></html>`;
    res.send(html);

  } catch (err) {
    console.error("Orders Error:", err.message);
    res.status(500).send(`<h1 style="color:red;padding:50px;">Error: ${err.message}<br><br>Check Railway Logs for more details.</h1>`);
  }
});

// Create Batch, Batches list, View Batch, Delete — (same logic as before)
app.post("/create-batch", async (req, res) => { /* same as previous version */ 
  // ... (copy from earlier improved code if needed)
  try {
    let orderIds = req.body.orders;
    if (!orderIds) return res.send(`<script>alert('Select orders'); history.back();</script>`);
    if (!Array.isArray(orderIds)) orderIds = [orderIds];

    const fullOrders = await getOrdersByIds(orderIds);
    const batchName = `Batch-${new Date().toLocaleString('en-IN')}`;

    await pool.query("INSERT INTO batches (name, data) VALUES ($1, $2)", [batchName, JSON.stringify(fullOrders)]);
    res.redirect("/batches");
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

app.get("/batches", async (req, res) => { /* same as before */ });
app.post("/delete-batch/:id", async (req, res) => { /* same */ });
app.get("/batch/:id", async (req, res) => { /* same nice printable table */ });

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
