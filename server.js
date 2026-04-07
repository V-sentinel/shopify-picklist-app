import express from "express";
import fetch from "node-fetch";
import pkg from 'pg';
const { Pool } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;

// ================= 1. CONFIG & URL FIXER =================
const RAW_SHOP = process.env.SHOP_NAME || process.env.SHOPIFY_STORE;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

// Automatically cleans the URL to prevent ENOTFOUND errors
const CLEAN_SHOP = RAW_SHOP?.replace('https://', '').replace('.myshopify.com', '').trim();
const SHOP = `${CLEAN_SHOP}.myshopify.com`;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= 2. DATABASE REPAIR & INIT =================
// This runs every time the app starts to ensure your table has the right columns
const initAndRepairDb = async () => {
  try {
    // Ensure table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS picklists (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add order_number column if missing (Fixes previous error)
    await pool.query(`
      ALTER TABLE picklists 
      ADD COLUMN IF NOT EXISTS order_number TEXT UNIQUE;
    `);

    // Add items_json column if missing (Fixes your current error)
    await pool.query(`
      ALTER TABLE picklists 
      ADD COLUMN IF NOT EXISTS items_json JSONB;
    `);
    
    console.log("✅ Database structure is updated and ready.");
  } catch (err) {
    console.error("❌ Database setup error:", err.message);
  }
};
initAndRepairDb();

// ================= 3. SHOPIFY AUTH =================
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
  throw new Error(`Shopify Auth Failed: ${data.error_description || 'Check API Credentials'}`);
}

// ================= 4. ROUTES =================

// HOME PAGE
app.get("/", (req, res) => {
  res.send(`
    <div style="font-family:sans-serif; padding:40px; text-align:center; max-width:600px; margin:auto;">
      <h1 style="color:#008060;">📦 Picklist System</h1>
      <p>Store: <b>${SHOP}</b></p>
      <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
      <form action="/sync" method="POST" style="margin-bottom:10px;">
        <button type="submit" style="background:#008060; color:white; padding:15px 30px; border:none; border-radius:5px; cursor:pointer; font-weight:bold; width:100%;">
          Sync Shopify Orders to Database
        </button>
      </form>
      <a href="/view" style="display:block; padding:15px 30px; background:#f4f6f8; color:#333; text-decoration:none; border-radius:5px; border:1px solid #ccc; font-weight:bold;">
        View Saved Picklists
      </a>
    </div>
  `);
});

// SYNC ROUTE: Shopify -> Postgres
app.post("/sync", async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(`https://${SHOP}/admin/api/2026-01/orders.json?status=unfulfilled`, {
      headers: { "X-Shopify-Access-Token": token }
    });
    const data = await response.json();

    if (!data.orders || data.orders.length === 0) {
      return res.send("No new unfulfilled orders found. <a href='/'>Go Back</a>");
    }

    // Save to DB (Uses ON CONFLICT to prevent duplicates)
    for (const order of data.orders) {
      await pool.query(
        `INSERT INTO picklists (order_number, items_json) 
         VALUES ($1, $2) 
         ON CONFLICT (order_number) DO NOTHING`,
        [order.name, JSON.stringify(order.line_items)]
      );
    }

    res.redirect("/view");
  } catch (err) {
    res.status(500).send(`<h1>Sync Error</h1><p>${err.message}</p><a href="/">Try Again</a>`);
  }
});

// VIEW ROUTE: Pull from Postgres
app.get("/view", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM picklists ORDER BY created_at DESC");
    
    let html = `
      <div style="font-family:sans-serif; padding:20px; max-width:800px; margin:auto;">
        <h1>Saved Picklists</h1>
        <a href="/">← Back to Home</a><hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
    `;

    if (result.rows.length === 0) {
      html += "<p>The database is currently empty. Try syncing first!</p>";
    }

    result.rows.forEach(row => {
      html += `
        <div style="border:1px solid #dfe3e8; padding:15px; margin-bottom:15px; border-radius:8px; background:#f9fafb;">
          <div style="display:flex; justify-content:space-between;">
            <b style="font-size:1.2em;">Order ${row.order_number}</b>
            <span style="color:#637381; font-size:0.8em;">${new Date(row.created_at).toLocaleString()}</span>
          </div>
          <ul style="margin:10px 0 0 0;">
            ${row.items_json.map(item => `<li><b>${item.quantity}x</b> ${item.title}</li>`).join('')}
          </ul>
        </div>`;
    });

    res.send(html + "</div>");
  } catch (err) {
    res.status(500).send(`<h1>Database Error</h1><p>${err.message}</p>`);
  }
});

// START SERVER
app.listen(PORT, () => {
  console.log(`🚀 Picklist App active on port ${PORT}`);
});
