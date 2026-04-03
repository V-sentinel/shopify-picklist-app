const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const SHOP = process.env.SHOP_NAME?.trim();
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET?.trim();
const DATABASE_URL = process.env.DATABASE_URL || 
                     process.env.DATABASE_PRIVATE_URL || 
                     process.env.DATABASE_PUBLIC_URL;

console.log("🔧 Starting Picklist App...");
console.log("DATABASE_URL found:", DATABASE_URL ? "✅ Yes" : "❌ No");
console.log("Using:", DATABASE_URL ? DATABASE_URL.substring(0, 60) + "..." : "None");

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ Missing Shopify credentials. App may fail on /orders route.");
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= DATABASE (Safe & Optimized) =================
let pool;
if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 8,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
  });
} else {
  console.error("❌ No DATABASE_URL found. Database features will be disabled.");
}

async function initDB() {
  if (!pool) {
    console.log("⚠️  Skipping DB initialization (no DATABASE_URL)");
    return;
  }

  let retries = 3;
  while (retries > 0) {
    try {
      const client = await pool.connect();
      await client.query(`
        CREATE TABLE IF NOT EXISTS batches (
          id SERIAL PRIMARY KEY,
          name TEXT,
          data JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_batches_created_at ON batches(created_at DESC);`);
      client.release();
      console.log("✅ Database Connected + Table & Index Ready");
      return;
    } catch (err) {
      retries--;
      console.error(`❌ DB Connection Failed (${3-retries}/3):`, err.message);
      if (retries > 0) await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.error("❌ Database failed to connect after retries. Picklist saving will not work.");
}

// Run DB init at startup (non-blocking)
initDB();

// ================= TOKEN CACHE (Client Credentials) =================
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

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
    throw new Error(`Token failed: ${data.error || 'Unknown'}`);
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3500 * 1000;
  console.log("✅ Shopify token obtained");
  return cachedToken;
}

// ================= FETCH ORDERS =================
async function getOrders() {
  const token = await getAccessToken();
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled&limit=50`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  if (!response.ok) throw new Error(`Shopify error ${response.status}`);
  const data = await response.json();
  return data.orders || [];
}

async function getOrdersByIds(ids) {
  const token = await getAccessToken();
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?ids=${ids.join(",")}`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  if (!response.ok) throw new Error(`Shopify error ${response.status}`);
  const data = await response.json();
  return data.orders || [];
}

// ================= ROUTES =================
app.get("/", (req, res) => res.redirect("/orders"));

app.get("/orders", async (req, res) => {
  try {
    const orders = await getOrders();

    let html = `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Picklist • ${SHOP || 'Shopify'}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    </head>
    <body class="bg-gray-50">
      <div class="max-w-6xl mx-auto p-6">
        <h1 class="text-4xl font-bold mb-8 flex items-center gap-3">📦 Picklist Generator</h1>
        <a href="/batches" class="text-emerald-600 mb-6 inline-block">📋 View Saved Picklists →</a>

        <form method="POST" action="/create-batch" class="space-y-6">
          <button type="submit" class="px-8 py-4 bg-emerald-600 text-white rounded-2xl font-semibold text-lg">Create New Picklist</button>

          <div class="grid gap-4">
    `;

    if (orders.length === 0) {
      html += `<p class="text-gray-500 py-12">No unfulfilled orders found.</p>`;
    } else {
      orders.forEach(order => {
        const customer = order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() || "No customer" : "No customer";
        const totalItems = order.line_items.reduce((sum, i) => sum + (i.quantity || 0), 0);

        html += `
        <div class="bg-white p-6 rounded-3xl border flex gap-6 items-center">
          <input type="checkbox" name="orders" value="${order.id}" class="w-5 h-5 accent-emerald-600 mt-1">
          <div class="flex-1">
            <strong class="text-xl block">${order.name}</strong>
            <p class="text-gray-600">${customer}</p>
            <div class="mt-3 flex flex-wrap gap-2">
              ${order.line_items.map(i => `<span class="text-xs bg-gray-100 px-3 py-1 rounded-xl">${i.sku || "NO-SKU"} × ${i.quantity}</span>`).join("")}
            </div>
          </div>
          <div class="text-right">
            <div class="text-3xl font-bold text-gray-800">${totalItems}</div>
            <div class="text-xs text-gray-500">ITEMS</div>
          </div>
        </div>`;
      });
    }

    html += `</div></form></div></body></html>`;
    res.send(html);
  } catch (err) {
    console.error("Orders route error:", err.message);
    res.status(500).send(`<h1 style="color:red;padding:40px;">Error: ${err.message}<br><br>Check Railway logs.</h1>`);
  }
});

// Create Batch
app.post("/create-batch", async (req, res) => {
  try {
    let orderIds = req.body.orders;
    if (!orderIds) return res.send(`<script>alert("Select at least one order");history.back();</script>`);
    if (!Array.isArray(orderIds)) orderIds = [orderIds];

    const fullOrders = await getOrdersByIds(orderIds);
    const batchName = `Batch-${new Date().toLocaleString('en-IN')}`;

    if (pool) {
      await pool.query("INSERT INTO batches (name, data) VALUES ($1, $2)", [batchName, JSON.stringify(fullOrders)]);
    }

    res.redirect("/batches");
  } catch (err) {
    console.error("Create batch error:", err);
    res.status(500).send("Error saving batch: " + err.message);
  }
});

// View Batches
app.get("/batches", async (req, res) => {
  try {
    if (!pool) return res.send("<h1>Database not connected</h1>");
    const result = await pool.query("SELECT * FROM batches ORDER BY created_at DESC");
    // ... (simple list - you can expand if needed)
    let html = `<h1>Saved Picklists</h1><a href="/orders">← Back</a><br><br>`;
    result.rows.forEach(b => {
      html += `<div><strong>${b.name}</strong> - <a href="/batch/${b.id}">View</a></div><br>`;
    });
    res.send(html);
  } catch (err) {
    res.status(500).send("DB Error: " + err.message);
  }
});

// View Single Batch (print friendly)
app.get("/batch/:id", async (req, res) => {
  try {
    if (!pool) return res.send("Database not connected");
    const result = await pool.query("SELECT * FROM batches WHERE id=$1", [req.params.id]);
    if (result.rows.length === 0) return res.send("Not found");

    const orders = result.rows[0].data;
    const skuMap = {};
    orders.forEach(order => {
      order.line_items.forEach(item => {
        const sku = item.sku || "NO-SKU";
        if (!skuMap[sku]) skuMap[sku] = { name: item.name, qty: 0 };
        skuMap[sku].qty += item.quantity || 0;
      });
    });

    let html = `<h1>Picklist - ${result.rows[0].name}</h1><button onclick="window.print()">Print</button><table border="1" style="border-collapse:collapse;margin-top:20px;">`;
    html += `<tr><th>SKU</th><th>Product</th><th>Qty</th></tr>`;
    Object.keys(skuMap).sort().forEach(sku => {
      html += `<tr><td>${sku}</td><td>${skuMap[sku].name}</td><td>${skuMap[sku].qty}</td></tr>`;
    });
    html += `</table>`;
    res.send(html);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running successfully on port ${PORT}`);
});
