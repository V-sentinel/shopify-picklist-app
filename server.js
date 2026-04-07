const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const SHOP = (process.env.SHOP_NAME || "").trim();
const CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL;

console.log("🚀 Starting Picklist App on Render...");
console.log("SHOP_NAME:", SHOP ? "✅" : "❌");
console.log("CLIENT_ID:", CLIENT_ID ? "✅" : "❌");
console.log("CLIENT_SECRET:", CLIENT_SECRET ? "✅" : "❌");
console.log("DATABASE_URL:", DATABASE_URL ? "✅" : "❌");

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ Missing Shopify credentials! Check Render Environment Variables.");
}

// ================= DATABASE =================
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 8,
}) : null;

async function initDB() {
  if (!pool) {
    console.warn("⚠️ No DATABASE_URL - Database disabled");
    return;
  }
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
    console.error("❌ DB Error:", err.message);
  }
}
initDB();

// ================= TOKEN =================
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const response = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  const data = await response.json();
  if (!data.access_token) throw new Error("Shopify token failed");

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3400000;
  return cachedToken;
}

// ================= BULK ACTION (Creates the menu option in Shopify) =================
app.get("/bulk-action", async (req, res) => {
  const ids = req.query.ids ? req.query.ids.split(",") : [];
  if (ids.length === 0) return res.redirect("/view-picklists");

  try {
    const token = await getAccessToken();
    const response = await fetch(
      `https://${SHOP}.myshopify.com/admin/api/2025-01/orders.json?ids=${ids.join(",")}`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    const data = await response.json();

    for (const order of (data.orders || [])) {
      if (pool) {
        await pool.query(
          `INSERT INTO picklists (order_name, order_data) 
           VALUES ($1, $2) ON CONFLICT (order_name) DO NOTHING`,
          [order.name, JSON.stringify(order)]
        );
      }
    }
    res.redirect("/view-picklists");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error: " + err.message);
  }
});

// View Picklists
app.get("/view-picklists", async (req, res) => {
  try {
    if (!pool) return res.send("<h1>Database not connected</h1>");
    const result = await pool.query("SELECT * FROM picklists ORDER BY created_at DESC");
    let html = `<h1>Saved Picklists (${result.rows.length})</h1><hr>`;
    result.rows.forEach(r => {
      const order = r.order_data;
      html += `<div style="border:1px solid #ccc; padding:15px; margin:10px;">
        <h3>${order.name}</h3>
        <p>Customer: ${order.customer ? order.customer.first_name + ' ' + (order.customer.last_name || '') : 'N/A'}</p>
      </div>`;
    });
    res.send(html);
  } catch (err) {
    res.send("Error loading picklists");
  }
});

app.get("/", (req, res) => {
  res.send(`<h1 style="padding:40px;text-align:center;">📦 Picklist App Running</h1>`);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server started on port ${PORT}`);
});
