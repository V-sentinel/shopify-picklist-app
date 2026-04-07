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
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL;

// Clean the shop name to ensure no https:// or .myshopify.com is doubled up
const CLEAN_SHOP = RAW_SHOP?.replace('https://', '').replace('.myshopify.com', '').trim();
const SHOP = `${CLEAN_SHOP}.myshopify.com`;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= 2. DB INIT =================
const initDB = async () => {
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
};
initDB();

// ================= 3. TOKEN LOGIC =================
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

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
  if (!data.access_token) throw new Error("Shopify Token Failed");

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3400000;
  return cachedToken;
}

// ================= 4. ROUTES =================

app.get("/bulk-action", async (req, res) => {
  // 1. CLEAN THE IDS: Shopify sends "gid://shopify/Order/12345"
  // We need to extract just the "12345"
  let rawIds = req.query.ids;
  if (!rawIds) return res.redirect("/view-picklists");

  const ids = Array.isArray(rawIds) ? rawIds : rawIds.split(",");
  const cleanIds = ids.map(id => id.split("/").pop());

  try {
    const token = await getAccessToken();
    const response = await fetch(
      `https://${SHOP}/admin/api/2024-10/orders.json?ids=${cleanIds.join(",")}`,
      { headers: { "X-Shopify-Access-Token": token } }
    );
    const data = await response.json();

    if (!data.orders) throw new Error("No orders returned from Shopify");

    for (const order of data.orders) {
      await pool.query(
        `INSERT INTO picklists (order_name, order_data) 
         VALUES ($1, $2) ON CONFLICT (order_name) DO NOTHING`,
        [order.name, JSON.stringify(order)]
      );
    }
    res.redirect("/view-picklists");
  } catch (err) {
    console.error("Bulk Action Error:", err.message);
    res.status(500).send(`Error creating picklist: ${err.message}`);
  }
});

app.get("/view-picklists", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM picklists ORDER BY created_at DESC");
    
    let html = `
      <div style="font-family:sans-serif; padding:20px; max-width:800px; margin:auto;">
        <h1>Saved Picklists (${result.rows.length})</h1>
        <a href="/">← Back</a> | <button onclick="window.print()">Print All</button>
        <hr>
    `;

    result.rows.forEach(r => {
      const order = r.order_data;
      html += `
        <div style="border:1px solid #ccc; padding:15px; margin-bottom:10px; border-radius:8px;">
          <h3>Order: ${r.order_name}</h3>
          <ul>
            ${order.line_items.map(item => `<li>${item.quantity}x ${item.title}</li>`).join('')}
          </ul>
        </div>`;
    });
    res.send(html + "</div>");
  } catch (err) {
    res.send("Error loading picklists: " + err.message);
  }
});

app.get("/", (req, res) => {
  res.send(`
    <div style="padding:50px; font-family:sans-serif; text-align:center;">
      <h1>📦 Picklist App is Running</h1>
      <p>Go to Shopify Admin → Orders → Select Orders → Click ... menu → Create Picklist</p>
      <a href="/view-picklists" style="display:inline-block; padding:10px 20px; background:#008060; color:white; text-decoration:none; border-radius:5px;">View Saved Picklists</a>
    </div>
  `);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server started on port ${PORT}`);
});
