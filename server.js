const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const SHOP = process.env.SHOP_NAME?.trim();
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET?.trim();
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL;

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ Missing Shopify credentials in environment variables");
}

console.log("🚀 Starting Picklist App...");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= DATABASE =================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS picklists (
        id SERIAL PRIMARY KEY,
        order_name TEXT UNIQUE,
        order_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Database table ready");
  } catch (err) {
    console.error("❌ DB Init Error:", err.message);
  }
}
initDB();

// ================= TOKEN =================
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error("Failed to get Shopify token");

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3400000; // ~57 minutes
  return cachedToken;
}

// ================= ROUTES =================

// 1. Bulk Action from Shopify Orders (This makes "Create Picklist" appear in menu)
app.get("/bulk-action", async (req, res) => {
  const orderIds = req.query.ids ? req.query.ids.split(',') : [];
  
  if (orderIds.length === 0) {
    return res.send("<h2>No orders selected</h2><a href='/'>Back</a>");
  }

  try {
    const token = await getAccessToken();
    const response = await fetch(
      `https://${SHOP}.myshopify.com/admin/api/2025-01/orders.json?ids=${orderIds.join(',')}`,
      { headers: { "X-Shopify-Access-Token": token } }
    );

    const data = await response.json();
    const orders = data.orders || [];

    // Save each order as picklist
    for (const order of orders) {
      await pool.query(
        `INSERT INTO picklists (order_name, order_data) 
         VALUES ($1, $2) 
         ON CONFLICT (order_name) DO NOTHING`,
        [order.name, JSON.stringify(order)]
      );
    }

    res.redirect("/view-picklists");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating picklist: " + err.message);
  }
});

// 2. View All Saved Picklists
app.get("/view-picklists", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM picklists ORDER BY created_at DESC");

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Picklists</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-50 p-8">
        <div class="max-w-5xl mx-auto">
          <h1 class="text-3xl font-bold mb-6">📦 Saved Picklists (${result.rows.length})</h1>
          <a href="https://${SHOP}.myshopify.com/admin/orders" class="text-blue-600 mb-8 inline-block">← Back to Shopify Orders</a>
    `;

    if (result.rows.length === 0) {
      html += "<p class='text-gray-500'>No picklists created yet.</p>";
    } else {
      result.rows.forEach(row => {
        const order = row.order_data;
        const items = order.line_items || [];
        const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

        html += `
          <div class="bg-white border rounded-xl p-6 mb-6 shadow-sm">
            <div class="flex justify-between items-start mb-4">
              <div>
                <h2 class="text-2xl font-semibold">${order.name}</h2>
                <p class="text-gray-600">${order.customer?.first_name} ${order.customer?.last_name || ''}</p>
              </div>
              <div class="text-right">
                <div class="text-xl font-bold">${totalItems} items</div>
                <div class="text-sm text-gray-500">${new Date(row.created_at).toLocaleString('en-IN')}</div>
              </div>
            </div>
            
            <table class="w-full border-collapse text-sm">
              <thead>
                <tr class="bg-gray-100">
                  <th class="text-left p-3">SKU</th>
                  <th class="text-left p-3">Product</th>
                  <th class="text-center p-3">Qty</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(item => `
                  <tr class="border-t">
                    <td class="p-3 font-mono">${item.sku || '—'}</td>
                    <td class="p-3">${item.title}</td>
                    <td class="p-3 text-center font-semibold">${item.quantity}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>`;
      });
    }

    html += `</div></body></html>`;
    res.send(html);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// 3. Simple Home (for testing)
app.get("/", (req, res) => {
  res.send(`
    <div style="padding:40px; font-family:sans-serif; text-align:center;">
      <h1>📦 Picklist App Ready</h1>
      <p>Go to Shopify Orders → Select orders → Click "..." → Create Picklist</p>
      <a href="/view-picklists">View All Picklists</a>
    </div>
  `);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Picklist App running on port ${PORT}`);
});
