const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const SHOP = (process.env.SHOP_NAME || "").trim();
const CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL;

console.log("🚀 Starting Picklist App...");
console.log("SHOP:", SHOP ? "✅ Set" : "❌ MISSING");
console.log("CLIENT_ID:", CLIENT_ID ? "✅ Set" : "❌ MISSING");
console.log("CLIENT_SECRET:", CLIENT_SECRET ? "✅ Set" : "❌ MISSING");
console.log("DATABASE_URL:", DATABASE_URL ? "✅ Found" : "❌ MISSING");

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ Missing Shopify credentials. App cannot start properly.");
}

// ================= DATABASE =================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

async function initDB() {
  if (!DATABASE_URL) {
    console.warn("⚠️ No DATABASE_URL found - Database features disabled");
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS picklists (
        id SERIAL PRIMARY KEY,
        order_name TEXT UNIQUE,
        order_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Database table ready");
  } catch (err) {
    console.error("❌ Database initialization failed:", err.message);
  }
}
initDB();

// ================= TOKEN CACHE =================
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
  if (!data.access_token) {
    throw new Error("Failed to get Shopify access token");
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3400000; // ~57 min
  return cachedToken;
}

// ================= ROUTES =================

// Bulk Action - This is what appears in the Shopify Orders "..." menu
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
    const orders = data.orders || [];

    for (const order of orders) {
      await pool.query(
        `INSERT INTO picklists (order_name, order_data) 
         VALUES ($1, $2) 
         ON CONFLICT (order_name) DO NOTHING`,
        [order.name, JSON.stringify(order)]
      );
    }

    res.redirect("/view-picklists");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error: " + err.message);
  }
});

// View Saved Picklists
app.get("/view-picklists", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM picklists ORDER BY created_at DESC");
    // ... (clean Tailwind UI for viewing picklists - same as previous version)
    let html = `...`; // Use the nice table version from my previous response
    res.send(html);
  } catch (err) {
    res.status(500).send("Error loading picklists");
  }
});

// Simple root page
app.get("/", (req, res) => {
  res.send(`
    <h1 style="padding:40px; font-family:sans-serif; text-align:center;">
      📦 Picklist App is Running<br><br>
      Go to Shopify Orders → Select orders → Click ... → Create Picklist
    </h1>
  `);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
