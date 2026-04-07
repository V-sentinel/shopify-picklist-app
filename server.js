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
const SHOP = RAW_SHOP?.includes(".") ? RAW_SHOP : `${RAW_SHOP}.myshopify.com`;

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for most cloud DBs like Railway/Render
});

// ================= 2. DATABASE INIT =================
// Create the table structure if it doesn't exist
const initDb = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS picklists (
      id SERIAL PRIMARY KEY,
      order_number TEXT,
      items_json JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await pool.query(queryText);
};
initDb().catch(console.error);

// ================= 3. AUTH CACHE =================
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

// HOME PAGE
app.get("/", (req, res) => {
  res.send(`
    <div style="font-family:sans-serif; padding:20px;">
      <h1>📦 Picklist Manager</h1>
      <div style="margin-bottom: 20px;">
        <a href="/orders" style="margin-right:10px;">View Shopify Orders</a>
        <a href="/view-picklists">View Saved Picklists (DB)</a>
      </div>
      <form action="/generate-picklist" method="POST">
        <button type="submit" style="background:#008060; color:white; border:none; padding:12px 20px; cursor:pointer; border-radius:5px; font-weight:bold;">
          Generate & Save Picklist from Shopify
        </button>
      </form>
    </div>
  `);
});

// GENERATE PICKLIST (Shopify -> Database)
app.post("/generate-picklist", async (req, res) => {
  try {
    const token = await getAccessToken();
    
    // 1. Fetch unfulfilled orders from Shopify
    const response = await fetch(`https://${SHOP}/admin/api/2025-01/orders.json?status=unfulfilled`, {
      headers: { "X-Shopify-Access-Token": token }
    });
    const data = await response.json();

    if (!data.orders || data.orders.length === 0) {
      return res.send("No unfulfilled orders to pick! <a href='/'>Back</a>");
    }

    // 2. Save each order into your PostgreSQL Database
    for (const order of data.orders) {
      await pool.query(
        "INSERT INTO picklists (order_number, items_json) VALUES ($1, $2)",
        [order.name, JSON.stringify(order.line_items)]
      );
    }

    res.send(`<h1>Success!</h1><p>Saved ${data.orders.length} orders to the database.</p><a href="/view-picklists">View Picklists</a>`);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

// VIEW PICKLISTS (Read from Database)
app.get("/view-picklists", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM picklists ORDER BY created_at DESC");
    
    let html = `
      <div style="font-family:sans-serif; padding:20px;">
        <h1>Database Picklists</h1>
        <a href="/">← Back to Home</a><br><br>
    `;

    result.rows.forEach(row => {
      html += `
        <div style="border:1px solid #dfe3e8; padding:15px; margin-bottom:10px; border-radius:8px; background:#f9fafb;">
          <b>Order: ${row.order_number}</b> <small style="color:gray;">Saved at: ${row.created_at.toLocaleString()}</small><br>
          <ul style="margin:5px 0 0 0; font-size:0.9em;">
            ${row.items_json.map(item => `<li>${item.quantity}x ${item.title}</li>`).join('')}
          </ul>
        </div>`;
    });

    res.send(html + "</div>");
  } catch (err) {
    res.status(500).send(`Database Error: ${err.message}`);
  }
});

app.get("/orders", async (req, res) => {
    try {
      const token = await getAccessToken();
      const response = await fetch(`https://${SHOP}/admin/api/2025-01/orders.json?status=unfulfilled`, {
        headers: { "X-Shopify-Access-Token": token }
      });
      const data = await response.json();
      res.send(`<h1>Live Shopify Orders</h1><pre>${JSON.stringify(data.orders, null, 2)}</pre><a href="/">Back</a>`);
    } catch (err) { res.send(err.message); }
});

app.listen(PORT, () => console.log(`🚀 Picklist App + DB running on ${PORT}`));
