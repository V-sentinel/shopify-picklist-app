import express from "express";
import fetch from "node-fetch";
import pkg from 'pg';
const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;

// ================= 1. CONFIG =================
const RAW_SHOP = process.env.SHOP_NAME || process.env.SHOPIFY_STORE;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const CLEAN_SHOP = RAW_SHOP?.replace('https://', '').replace('.myshopify.com', '').trim();
const SHOP = `${CLEAN_SHOP}.myshopify.com`;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= 2. DATABASE REPAIR =================
// This block checks for the column and adds it if missing
const repairDb = async () => {
  try {
    // Ensure table exists first
    await pool.query(`
      CREATE TABLE IF NOT EXISTS picklists (
        id SERIAL PRIMARY KEY,
        items_json JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Force add the order_number column if it's missing
    await pool.query(`
      ALTER TABLE picklists 
      ADD COLUMN IF NOT EXISTS order_number TEXT UNIQUE;
    `);
    
    console.log("✅ Database Table Structure Verified");
  } catch (err) {
    console.error("❌ DB Repair Failed:", err.message);
  }
};
repairDb();

// ================= 3. AUTH =================
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  const response = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);
  return cachedToken;
}

// ================= 4. ROUTES =================

app.get("/", (req, res) => {
  res.send(`
    <div style="font-family:sans-serif; padding:40px; text-align:center;">
      <h1>📦 Picklist System</h1>
      <p>Status: <b>Connected</b></p>
      <form action="/generate" method="POST" style="display:inline;">
        <button type="submit" style="background:#008060; color:white; padding:15px 30px; border:none; border-radius:5px; cursor:pointer;">
          Sync Shopify to Database
        </button>
      </form>
      <a href="/view" style="padding:15px 30px; text-decoration:none; color:#333;">View Picklists</a>
    </div>
  `);
});

app.post("/generate", async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(`https://${SHOP}/admin/api/2026-01/orders.json?status=unfulfilled`, {
      headers: { "X-Shopify-Access-Token": token }
    });
    const data = await response.json();

    if (!data.orders || data.orders.length === 0) return res.send("No new orders. <a href='/'>Back</a>");

    for (const order of data.orders) {
      await pool.query(
        "INSERT INTO picklists (order_number, items_json) VALUES ($1, $2) ON CONFLICT (order_number) DO NOTHING",
        [order.name, JSON.stringify(order.line_items)]
      );
    }
    res.redirect("/view");
  } catch (err) {
    res.status(500).send(`<h1>Sync Error</h1><p>${err.message}</p><a href="/">Try Again</a>`);
  }
});

app.get("/view", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM picklists ORDER BY created_at DESC");
    let html = `<div style="font-family:sans-serif; padding:20px;"><h1>Database Records</h1><a href="/">← Home</a><hr>`;
    result.rows.forEach(row => {
      html += `
        <div style="border:1px solid #ccc; padding:10px; margin-bottom:10px; border-radius:5px;">
          <b>Order ${row.order_number}</b>
          <ul>${row.items_json.map(i => `<li>${i.quantity}x ${i.title}</li>`).join('')}</ul>
        </div>`;
    });
    res.send(html + "</div>");
  } catch (err) { res.status(500).send(err.message); }
});

app.listen(PORT, () => console.log(`🚀 Online on port ${PORT}`));
