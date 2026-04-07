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

// ================= 2. DB AUTO-REPAIR =================
const initDb = async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS picklists (id SERIAL PRIMARY KEY, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    await pool.query(`ALTER TABLE picklists ADD COLUMN IF NOT EXISTS order_number TEXT UNIQUE;`);
    await pool.query(`ALTER TABLE picklists ADD COLUMN IF NOT EXISTS items_json JSONB;`);
    console.log("✅ Database Ready");
  } catch (err) { console.error("❌ DB Error:", err.message); }
};
initDb();

// ================= 3. AUTH =================
async function getAccessToken() {
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
  return data.access_token;
}

// ================= 4. ROUTES =================

app.get("/", (req, res) => {
  res.send(`
    <div style="font-family:sans-serif; padding:40px; text-align:center;">
      <h1 style="color:#008060;">📦 Picklist System</h1>
      <p>Store: <b>${SHOP}</b></p>
      <form action="/sync" method="POST">
        <button type="submit" style="background:#008060; color:white; padding:15px 30px; border:none; border-radius:5px; cursor:pointer; font-weight:bold;">
          Sync All Unfulfilled Orders
        </button>
      </form>
      <br>
      <a href="/view" style="color:#008060; text-decoration:none;">View Saved Picklists →</a>
    </div>
  `);
});

// NEW: Action Menu Route (Handles the click from Shopify Admin)
app.get("/bulk-action", async (req, res) => {
  const ids = req.query.ids; // Shopify sends order IDs in the URL
  if (!ids) return res.redirect('/sync'); // If no specific IDs, just do a general sync

  try {
    const token = await getAccessToken();
    // Fetch specifically selected orders
    const response = await fetch(`https://${SHOP}/admin/api/2026-01/orders.json?ids=${ids}`, {
      headers: { "X-Shopify-Access-Token": token }
    });
    const data = await response.json();

    for (const order of data.orders) {
      await pool.query(
        "INSERT INTO picklists (order_number, items_json) VALUES ($1, $2) ON CONFLICT (order_number) DO NOTHING",
        [order.name, JSON.stringify(order.line_items)]
      );
    }
    res.send(`
      <div style="font-family:sans-serif; text-align:center; padding:50px;">
        <h2>✅ Success!</h2>
        <p>Selected orders have been added to your picklist.</p>
        <script>setTimeout(() => { window.location.href = '/view'; }, 1500);</script>
      </div>
    `);
  } catch (err) { res.status(500).send(err.message); }
});

app.post("/sync", async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(`https://${SHOP}/admin/api/2026-01/orders.json?status=unfulfilled`, {
      headers: { "X-Shopify-Access-Token": token }
    });
    const data = await response.json();
    for (const order of data.orders) {
      await pool.query("INSERT INTO picklists (order_number, items_json) VALUES ($1, $2) ON CONFLICT (order_number) DO NOTHING", [order.name, JSON.stringify(order.line_items)]);
    }
    res.redirect("/view");
  } catch (err) { res.status(500).send(err.message); }
});

app.get("/view", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM picklists ORDER BY created_at DESC");
    let html = `
      <div style="font-family:sans-serif; padding:20px; max-width:800px; margin:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h1>Saved Picklists</h1>
          <button onclick="window.print()" style="padding:10px 20px; cursor:pointer; background:#008060; color:white; border:none; border-radius:4px;">Print All</button>
        </div>
        <a href="/">← Home</a><hr>
    `;
    result.rows.forEach(row => {
      html += `
        <div style="border:2px solid #000; padding:15px; margin-bottom:20px; border-radius:8px; background:#fff;">
          <b style="font-size:1.2em;">Order ${row.order_number}</b>
          <ul style="margin-top:10px;">${row.items_json.map(item => `<li>${item.quantity}x ${item.title}</li>`).join('')}</ul>
        </div>`;
    });
    res.send(html + "</div>");
  } catch (err) { res.status(500).send(err.message); }
});

app.listen(PORT, () => console.log(`🚀 App on port ${PORT}`));
