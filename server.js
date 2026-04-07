import express from "express";
import fetch from "node-fetch";
import { Pool } from "pg";

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const SHOP = (process.env.SHOP_NAME || "").trim();
const CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL;

console.log("🚀 Starting Picklist App (ESM Version)...");
console.log("SHOP_NAME:", SHOP ? "✅" : "❌ MISSING");
console.log("CLIENT_ID:", CLIENT_ID ? "✅" : "❌ MISSING");
console.log("CLIENT_SECRET:", CLIENT_SECRET ? "✅" : "❌ MISSING");
console.log("DATABASE_URL:", DATABASE_URL ? "✅ Found" : "❌ MISSING");

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ Missing Shopify credentials in Render Environment Variables");
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
    console.log("✅ Database Ready");
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
  if (!data.access_token) throw new Error("Failed to get Shopify token");

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3400000;
  return cachedToken;
}

// ================= ROUTES =================

// 1. Bulk Action → This is what shows "Create Picklist" in Shopify Orders ... menu
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

// 2. View Saved Picklists
app.get("/view-picklists", async (req, res) => {
  try {
    if (!pool) return res.send("<h1>Database not connected</h1>");
    const result = await pool.query("SELECT * FROM picklists ORDER BY created_at DESC");

    let html = `<h1 style="padding:20px; font-family:sans-serif;">📦 Saved Picklists (${result.rows.length})</h1><hr>`;
    result.rows.forEach(r => {
      const order = r.order_data;
      html += `
        <div style="border:1px solid #ccc; margin:15px; padding:15px; border-radius:8px;">
          <h3>${order.name}</h3>
          <p><strong>Customer:</strong> ${order.customer ? `${order.customer.first_name} ${order.customer.last_name || ''}` : 'N/A'}</p>
          <small>Created: ${new Date(r.created_at).toLocaleString()}</small>
        </div>`;
    });
    res.send(html);
  } catch (err) {
    res.send("Error loading picklists");
  }
});

// 3. Home page
app.get("/", (req, res) => {
  res.send(`
    <div style="padding:60px; text-align:center; font-family:sans-serif;">
      <h1>📦 Picklist App is Running</h1>
      <p>Go to Shopify Orders → Select orders → Click the <strong>...</strong> menu → Create Picklist</p>
      <a href="/view-picklists" style="color:#008060; font-weight:bold;">View All Saved Picklists →</a>
    </div>
  `);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server started successfully on port ${PORT}`);
});
