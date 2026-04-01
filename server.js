const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const SHOP = process.env.SHOP_NAME;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= DATABASE =================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test DB
pool.query("SELECT NOW()")
  .then(() => console.log("✅ DB Connected"))
  .catch(err => console.error("❌ DB Error:", err));

// ================= TOKEN CACHE =================
let cachedToken = null;
let tokenExpiry = 0;

// ================= GET TOKEN =================
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const response = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials"
    })
  });

  const data = await response.json();

  if (!data.access_token) {
    console.error(data);
    throw new Error("Token generation failed");
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3600 * 1000;

  return cachedToken;
}

// ================= FETCH ORDERS =================
async function getOrders() {
  const token = await getAccessToken();

  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled&limit=50`,
    {
      headers: {
        "X-Shopify-Access-Token": token
      }
    }
  );

  const data = await response.json();
  return data.orders || [];
}

// ================= FETCH ORDERS BY IDS =================
async function getOrdersByIds(ids) {
  const token = await getAccessToken();

  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?ids=${ids.join(",")}`,
    {
      headers: {
        "X-Shopify-Access-Token": token
      }
    }
  );

  const data = await response.json();
  return data.orders || [];
}

// ================= ROUTES =================

// HOME
app.get("/", (req, res) => res.redirect("/orders"));

// ================= ORDERS PAGE =================
app.get("/orders", async (req, res) => {
  try {
    const orders = await getOrders();

    let html = `
    <style>
      body { font-family:sans-serif; background:#f6f6f7; padding:20px; }
      .card { background:white; padding:15px; margin:10px 0; border-radius:10px; display:flex; align-items:center; }
      .btn { background:#008060; color:white; padding:10px 20px; border:none; border-radius:8px; cursor:pointer; }
      .sku { background:#eee; padding:3px 6px; margin-right:5px; border-radius:4px; font-size:11px; }
    </style>

    <h1>📦 Picklist</h1>
    <a href="/batches">View Saved</a><br/><br/>

    <form method="POST" action="/create-batch">
    <button class="btn">Create Picklist</button>
    `;

    orders.forEach(order => {
      html += `
      <div class="card">
        <input type="checkbox" name="orders" value="${order.id}">
        <div style="margin-left:10px;">
          <strong>${order.name}</strong><br/>
          ${order.line_items.map(i => `<span class="sku">${i.sku || "NO-SKU"}</span>`).join("")}
        </div>
        <div style="margin-left:auto;">
          ${order.line_items.length} ITEMS
        </div>
      </div>
      `;
    });

    html += `</form>`;
    res.send(html);

  } catch (err) {
    res.send("Error loading orders: " + err.message);
  }
});

// ================= CREATE BATCH =================
app.post("/create-batch", async (req, res) => {
  try {
    let orders = req.body.orders;

    if (!orders) {
      return res.send("<script>alert('Select orders first'); window.history.back();</script>");
    }

    if (!Array.isArray(orders)) orders = [orders];

    // ✅ Fetch real order data from Shopify
    const fullOrders = await getOrdersByIds(orders);

    const batchName = `Batch-${Date.now()}`;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id SERIAL PRIMARY KEY,
        name TEXT,
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(
      "INSERT INTO batches (name, data) VALUES ($1, $2)",
      [batchName, JSON.stringify(fullOrders)]
    );

    res.redirect("/batches");

  } catch (err) {
    console.error(err);
    res.send("DB Error: " + err.message);
  }
});

// ================= VIEW BATCHES =================
app.get("/batches", async (req, res) => {
  const result = await pool.query("SELECT * FROM batches ORDER BY created_at DESC");

  let html = `<h1>Saved Picklists</h1><a href="/orders">Back</a><br/><br/>`;

  result.rows.forEach(batch => {
    html += `
      <div>
        <strong>${batch.name}</strong><br/>
        <a href="/batch/${batch.id}">View</a>
      </div><br/>
    `;
  });

  res.send(html);
});

// ================= VIEW PICKLIST =================
app.get("/batch/:id", async (req, res) => {
  const result = await pool.query("SELECT * FROM batches WHERE id=$1", [req.params.id]);

  if (result.rows.length === 0) return res.send("Not found");

  const orders = result.rows[0].data;

  const skuMap = {};

  orders.forEach(order => {
    order.line_items.forEach(item => {
      const sku = item.sku || "NO-SKU";

      if (!skuMap[sku]) {
        skuMap[sku] = { name: item.name, qty: 0 };
      }

      skuMap[sku].qty += item.quantity;
    });
  });

  let html = `<h1>Picklist</h1><a href="/batches">Back</a><table border="1" cellpadding="10">`;
  html += `<tr><th>SKU</th><th>Product</th><th>Qty</th></tr>`;

  Object.keys(skuMap).forEach(sku => {
    html += `
      <tr>
        <td>${sku}</td>
        <td>${skuMap[sku].name}</td>
        <td>${skuMap[sku].qty}</td>
      </tr>
    `;
  });

  html += `</table>`;
  res.send(html);
});

// ================= START SERVER =================
app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 App running on port " + PORT);
});
