const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CONFIG & STARTUP LOGS =================
const SHOP = (process.env.SHOP_NAME || "").trim();
const CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL;

console.log("🚀 Starting Picklist App on Render...");
console.log("SHOP_NAME:", SHOP ? "✅ Set" : "❌ MISSING");
console.log("CLIENT_ID:", CLIENT_ID ? "✅ Set" : "❌ MISSING");
console.log("CLIENT_SECRET:", CLIENT_SECRET ? "✅ Set" : "❌ MISSING");
console.log("DATABASE_URL:", DATABASE_URL ? "✅ Found" : "❌ MISSING");

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ CRITICAL: Missing Shopify credentials. Check Render Environment Variables.");
}

// ================= DATABASE (Safe) =================
let pool = null;
if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 8,
  });
} else {
  console.warn("⚠️ No DATABASE_URL → Database disabled (picklists won't save)");
}

async function initDB() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS picklists (
        id SERIAL PRIMARY KEY,
        order_name TEXT UNIQUE,
        order_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Database ready");
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
  if (!data.access_token) throw new Error("Shopify token failed");

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3400000;
  return cachedToken;
}

// ================= ROUTES =================
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
          `INSERT INTO picklists (order_name, order_data) VALUES ($1, $2) ON CONFLICT (order_name) DO NOTHING`,
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

app.get("/view-picklists", async (req, res) => {
  try {
    if (!pool) return res.send("<h1>Database not connected</h1>");
    const result = await pool.query("SELECT * FROM picklists ORDER BY created_at DESC");
    // Simple view for now
    let html = "<h1>Saved Picklists</h1>";
    result.rows.forEach(row => {
      html += `<div><strong>${row.order_name}</strong></div>`;
    });
    res.send(html);
  } catch (err) {
    res.send("Error loading picklists");
  }
});

app.get("/", (req, res) => {
  res.send(`
    <h1 style="padding:50px; text-align:center; font-family:sans-serif;">
      📦 Picklist App Running on Render<br><br>
      Select orders in Shopify → Click ... → Create Picklist
    </h1>
  `);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server successfully started on port ${PORT}`);
});
