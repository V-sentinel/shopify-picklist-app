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

// HOME PAGE - Now with "Create Picklist" options
app.get("/", (req, res) => {
  res.send(`
    <div style="font-family:sans-serif; padding:40px; text-align:center; max-width:500px; margin:auto; border:1px solid #eee; border-radius:10px; margin-top:50px;">
      <h1 style="color:#008060;">📦 Picklist System</h1>
      <p style="color:#666;">Connected to: <b>${SHOP}</b></p>
      <hr style="border:0; border-top:1px solid #eee; margin:20px 0;">
      
      <h3>Manual Create</h3>
      <form action="/create-single" method="POST" style="margin-bottom:20px;">
        <input type="text" name="orderName" placeholder="Enter Order # (e.g. #1001)" required 
               style="padding:10px; width:70%; border:1px solid #ccc; border-radius:4px; margin-bottom:10px;">
        <button type="submit" style="background:#008060; color:white; padding:10px 20px; border:none; border-radius:5px; cursor:pointer; width:75%;">
          Create Picklist for this Order
        </button>
      </form>

      <div style="background:#f4f6f8; padding:15px; border-radius:5px;">
        <h3>Bulk Actions</h3>
        <form action="/sync" method="POST" style="margin-bottom:10px;">
          <button type="submit" style="background:#5c6ac4; color:white; padding:12px; border:none; border-radius:5px; cursor:pointer; width:100%;">
            Sync All Unfulfilled Orders
          </button>
        </form>
        <a href="/view" style="display:block; text-decoration:none; color:#008060; font-weight:bold; margin-top:10px;">View Saved Picklists →</a>
      </div>
    </div>
  `);
});

// NEW: Manual Create Route (Finds 1 specific order by name)
app.post("/create-single", express.urlencoded({ extended: true }), async (req, res) => {
  const { orderName } = req.body;
  try {
    const token = await getAccessToken();
    // Search Shopify for the specific order name
    const response = await fetch(`https://${SHOP}/admin/api/2026-01/orders.json?name=${encodeURIComponent(orderName)}&status=any`, {
      headers: { "X-Shopify-Access-Token": token }
    });
    const data = await response.json();

    if (!data.orders || data.orders.length === 0) {
      return res.send(`<h2>Order Not Found</h2><p>Could not find "${orderName}".</p><a href="/">Back</a>`);
    }

    const order = data.orders[0];
    await pool.query(
      "INSERT INTO picklists (order_number, items_json) VALUES ($1, $2) ON CONFLICT (order_number) DO NOTHING",
      [order.name, JSON.stringify(order.line_items)]
    );

    res.redirect("/view");
  } catch (err) { res.status(500).send(err.message); }
});

// ROUTE: Bulk Action (Handles clicks from Shopify Admin Menu)
app.get("/bulk-action", async (req, res) => {
  const ids = req.query.ids; 
  if (!ids) return res.redirect('/sync'); 

  try {
    const token = await getAccessToken();
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
    res.redirect("/view");
  } catch (err) { res.status(500).send(err.message); }
});

// ROUTE: Sync All
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

// VIEW PAGE
app.get("/view", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM picklists ORDER BY created_at DESC");
    let html = `
      <div style="font-family:sans-serif; padding:20px; max-width:800px; margin:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h1>Saved Picklists</h1>
          <button onclick="window.print()" style="padding:10px 20px; cursor:pointer; background:#008060; color:white; border:none; border-radius:4px;">Print All</button>
        </div>
        <a href="/">← Back to Home</a><hr style="margin:20px 0;">
    `;
    
    if (result.rows.length === 0) html += "<p>No picklists created yet.</p>";

    result.rows.forEach(row => {
      html += `
        <div style="border:2px solid #000; padding:20px; margin-bottom:20px; border-radius:8px; background:#fff; page-break-inside: avoid;">
          <div style="display:flex; justify-content:space-between; border-bottom:1px solid #eee; padding-bottom:10px;">
            <b style="font-size:1.5em;">Order ${row.order_number}</b>
            <span>Created: ${new Date(row.created_at).toLocaleDateString()}</span>
          </div>
          <ul style="margin-top:15px; font-size:1.1em; line-height:1.6;">
            ${row.items_json.map(item => `<li><b>${item.quantity}x</b> ${item.title}</li>`).join('')}
          </ul>
        </div>`;
    });
    res.send(html + "</div>");
  } catch (err) { res.status(500).send(err.message); }
});

app.listen(PORT, () => console.log(`🚀 App on port ${PORT}`));
