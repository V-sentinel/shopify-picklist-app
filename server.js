const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const SHOP = (process.env.SHOP_NAME || "").trim();
const CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
const DATABASE_URL = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= DATABASE INIT =================
// Added the missing columns "order_number" and "items_json" found in your error logs
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS picklists (
        id SERIAL PRIMARY KEY,
        order_name TEXT UNIQUE,
        order_number TEXT,
        order_data JSONB,
        items_json JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Database Ready");
  } catch (err) {
    console.error("❌ DB Error:", err.message);
  }
}
initDB();

// ================= TOKEN HELPERS =================
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
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3400000;
  return cachedToken;
}

// ================= ROUTES =================

app.get("/bulk-action", async (req, res) => {
  const ids = req.query.ids ? req.query.ids.split(",") : [];
  const cleanIds = ids.map(id => id.split("/").pop());

  try {
    const token = await getAccessToken();
    const response = await fetch(
      `https://${SHOP}.myshopify.com/admin/api/2024-10/orders.json?ids=${cleanIds.join(",")}`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    const data = await response.json();

    for (const order of (data.orders || [])) {
      await pool.query(
        `INSERT INTO picklists (order_name, order_number, order_data, items_json) 
         VALUES ($1, $2, $3, $4) ON CONFLICT (order_name) DO NOTHING`,
        [order.name, order.order_number.toString(), JSON.stringify(order), JSON.stringify(order.line_items)]
      );
    }
    res.redirect("/view-picklists");
  } catch (err) {
    res.status(500).send("Sync Error: " + err.message);
  }
});

app.get("/view-picklists", async (req, res) => {
  const result = await pool.query("SELECT * FROM picklists ORDER BY created_at DESC");
  let html = `<h1>Saved Picklists</h1><a href="/">Back</a><hr>`;
  result.rows.forEach(r => {
    html += `<div style="border:1px solid #000; margin:10px; padding:10px;">
              <h3>Order ${r.order_name}</h3>
              <pre>${JSON.stringify(r.items_json, null, 2)}</pre>
             </div>`;
  });
  res.send(html);
});

app.get("/", (req, res) => res.send("<h1>Picklist App is Running</h1><a href='/view-picklists'>View Picklists</a>"));

app.listen(PORT, "0.0.0.0", () => console.log(`Server on ${PORT}`));
