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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= 2. DATABASE INIT =================
const initDb = async () => {
  try {
    const queryText = `
      CREATE TABLE IF NOT EXISTS picklists (
        id SERIAL PRIMARY KEY,
        order_number TEXT UNIQUE,
        items_json JSONB,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.query(queryText);
    console.log("✅ Database Table Ready");
  } catch (err) {
    console.error("❌ DB Init Error:", err.message);
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
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);
  return cachedToken;
}

// ================= 4. ROUTES =================

app.get("/", (req, res) => {
  res.send(`
    <div style="font-family:sans-serif; padding:20px; max-width:600px; margin:auto; border:1px solid #eee; border-radius:10px;">
      <h1>📦 Picklist System</h1>
      <p>Store: <b>${SHOP}</b></p>
      <hr>
      <div style="display:flex; gap:10px; margin-top:20px;">
        <form action="/generate-picklist" method="POST">
          <button type="submit" style="background:#008060; color:white; border:none; padding:12px; cursor:pointer; border-radius:5px;">Generate Picklist</button>
        </form>
        <a href="/view-picklists" style="padding:12px; background:#f4f6f8; color:#333; text-decoration:none; border-radius:5px; border:1px solid #ccc;">View Database</a>
      </div>
      <form action="/clear-db" method="POST" style="margin-top:20px;">
        <button type="submit" style="background:transparent; color:red; border:1px solid red; padding:5px; cursor:pointer; font-size:12px;">Clear Database</button>
      </form>
    </div>
  `);
});

app.post("/generate-picklist", async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(`https://${SHOP}/admin/api/2026-01/orders.json?status=unfulfilled`, {
      headers: { "X-Shopify-Access-Token": token }
    });
    const data = await response.json();

    if (!data.orders || data.orders.length === 0) {
      return res.send("No unfulfilled orders found. <a href='/'>Back</a>");
    }

    for (const order of data.orders) {
      // Use ON CONFLICT to avoid errors if the order already exists in the DB
      await pool.query(
        `INSERT INTO picklists (order_number, items_json) 
         VALUES ($1, $2) 
         ON CONFLICT (order_number) DO NOTHING`,
        [order.name, JSON.stringify(order.line_items)]
      );
    }

    res.redirect("/view-picklists");
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

app.get("/view-picklists", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM picklists ORDER BY created_at DESC");
    let html = `<div style="font-family:sans-serif; padding:20px;"><h1>Saved Picklists</h1><a href="/">← Home</a><br><br>`;
    
    if (result.rows.length === 0) html += "<p>Database is empty.</p>";

    result.rows.forEach(row => {
      html += `
        <div style="border:1px solid #ccc; padding:15px; margin-bottom:10px; border-radius:8px;">
          <b>Order ${row.order_number}</b> | Status: ${row.status}<br>
          <ul style="font-size:0.9em; color:#555;">
            ${row.items_json.map(i => `<li>${i.quantity}x ${i.title}</li>`).join('')}
          </ul>
        </div>`;
    });
    res.send(html + "</div>");
  } catch (err) { res.status(500).send(err.message); }
});

app.post("/clear-db", async (req, res) => {
  await pool.query("DELETE FROM picklists");
  res.redirect("/");
});

app.listen(PORT, () => console.log(`🚀 Ready on Port ${PORT}`));
