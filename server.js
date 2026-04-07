import express from "express";
import fetch from "node-fetch";
import pkg from 'pg';
const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;

// ================= 1. CLEAN CONFIG =================
// Automatically fixes the store URL even if you entered it wrong
const RAW_SHOP = process.env.SHOP_NAME || process.env.SHOPIFY_STORE;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

const CLEAN_SHOP = RAW_SHOP?.replace('https://', '').replace('.myshopify.com', '').trim();
const SHOP = `${CLEAN_SHOP}.myshopify.com`;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= 2. DB INIT =================
const initDb = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS picklists (
        id SERIAL PRIMARY KEY,
        order_number TEXT UNIQUE,
        items_json JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Database Connected & Table Ready");
  } catch (err) {
    console.error("❌ DB Connection Failed:", err.message);
  }
};
initDb();

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
  if (data.access_token) {
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000);
    return cachedToken;
  }
  throw new Error(`Auth Failed: ${data.error || 'Check Client ID/Secret'}`);
}

// ================= 4. ROUTES =================

app.get("/", (req, res) => {
  if (!RAW_SHOP || !CLIENT_ID) {
    return res.status(500).send("<h1>Config Missing</h1><p>Set SHOP_NAME and CLIENT_ID in Render.</p>");
  }
  res.send(`
    <div style="font-family:sans-serif; padding:40px; text-align:center;">
      <h1 style="color:#008060;">📦 Picklist System</h1>
      <p>Store: <b>${SHOP}</b></p>
      <div style="margin-top:20px;">
        <form action="/generate" method="POST" style="display:inline;">
          <button type="submit" style="background:#008060; color:white; padding:15px 30px; border:none; border-radius:5px; cursor:pointer; font-weight:bold;">
            Sync Shopify to Database
          </button>
        </form>
        <a href="/view" style="display:inline-block; margin-left:10px; padding:15px 30px; background:#f4f6f8; color:#333; text-decoration:none; border-radius:5px; border:1px solid #ccc;">
          View Saved Picklists
        </a>
      </div>
    </div>
  `);
});

// SYNC: Fetch from Shopify -> Save to DB
app.post("/generate", async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(`https://${SHOP}/admin/api/2026-01/orders.json?status=unfulfilled`, {
      headers: { "X-Shopify-Access-Token": token }
    });
    const data = await response.json();

    if (!data.orders || data.orders.length === 0) {
      return res.send("No new orders to sync. <a href='/'>Back</a>");
    }

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

// VIEW: Show everything in DB
app.get("/view", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM picklists ORDER BY created_at DESC");
    let html = `<div style="font-family:sans-serif; padding:20px;"><h1>Database Records</h1><a href="/">← Home</a><hr>`;
    
    if (result.rows.length === 0) html += "<p>No picklists found in database.</p>";

    result.rows.forEach(row => {
      html += `
        <div style="border:1px solid #dfe3e8; padding:15px; margin-bottom:10px; border-radius:8px; background:#f9fafb;">
          <b>Order ${row.order_number}</b> <small style="color:gray;">(${row.created_at.toLocaleDateString()})</small>
          <ul>${row.items_json.map(i => `<li>${i.quantity}x ${i.title}</li>`).join('')}</ul>
        </div>`;
    });
    res.send(html + "</div>");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => console.log(`🚀 App online at port ${PORT}`));
