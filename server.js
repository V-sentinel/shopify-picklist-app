const express = require("express");
const fetch = require("node-fetch");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const SHOP = process.env.SHOP_NAME;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= DATABASE =================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test DB Connection
pool.query("SELECT NOW()")
  .then(() => console.log("✅ Database Connected"))
  .catch(err => console.error("❌ Database Connection Failed:", err));

// ================= SHOPIFY FETCH =================
async function getOrders() {
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled&limit=50`,
    {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
        "Content-Type": "application/json"
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
      body { font-family: -apple-system, sans-serif; background:#f6f6f7; padding:20px; }
      .header { display:flex; justify-content:space-between; align-items:center; }
      .card { background:white; padding:15px; margin:10px 0; border-radius:10px; display:flex; align-items:center; }
      .sku { background:#eee; padding:2px 6px; margin-right:5px; border-radius:4px; font-size:11px; }
      .btn { background:#008060; color:white; padding:10px 20px; border:none; border-radius:8px; cursor:pointer; }
    </style>

    <div class="header">
      <h1>📦 Picklist</h1>
      <a href="/batches">View Saved</a>
    </div>

    <form method="POST" action="/create-batch">
      <button class="btn">Create Batch Picklist</button>
    `;

    orders.forEach(order => {
      html += `
      <div class="card">
        <input type="checkbox" name="selected_orders" value='${JSON.stringify(order)}'>
        <div style="margin-left:10px;">
          <strong>${order.name}</strong><br/>
          ${order.line_items.map(i => `<span class="sku">${i.sku || "No SKU"}</span>`).join("")}
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
    console.error(err);
    res.send("Error loading orders");
  }
});

// ================= CREATE BATCH =================
app.post("/create-batch", async (req, res) => {
  try {
    let selected = req.body.selected_orders;

    if (!selected) {
      return res.send("<script>alert('Select orders first'); window.history.back();</script>");
    }

    // Ensure array
    if (!Array.isArray(selected)) selected = [selected];

    const parsedOrders = selected.map(o => JSON.parse(o));

    const batchName = `Batch #${Date.now()}`;

    // Create table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id SERIAL PRIMARY KEY,
        name TEXT,
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert batch
    await pool.query(
      "INSERT INTO batches (name, data) VALUES ($1, $2)",
      [batchName, JSON.stringify(parsedOrders)]
    );

    res.redirect("/batches");

  } catch (err) {
    console.error("❌ Batch Save Error:", err);

    res.send(`
      <h1 style="color:red;">Database Error</h1>
      <p>${err.message}</p>
      <a href="/orders">Go Back</a>
    `);
  }
});

// ================= VIEW BATCHES =================
app.get("/batches", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM batches ORDER BY created_at DESC");

    let html = `
    <style>
      body { font-family:sans-serif; background:#f6f6f7; padding:20px; }
      .card { background:white; padding:20px; margin-bottom:10px; border-radius:10px; }
      .btn { background:#007ace; color:white; padding:8px 15px; border-radius:5px; text-decoration:none; }
    </style>

    <h1>📜 Saved Picklists</h1>
    <a href="/orders">← Back</a><br/><br/>
    `;

    result.rows.forEach(batch => {
      const orders = batch.data;

      html += `
      <div class="card">
        <strong>${batch.name}</strong><br/>
        Orders: ${orders.length}<br/><br/>
        <a class="btn" href="/batch/${batch.id}">View Picklist</a>
      </div>
      `;
    });

    res.send(html);

  } catch (err) {
    res.send("Error loading batches");
  }
});

// ================= VIEW SINGLE PICKLIST =================
app.get("/batch/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM batches WHERE id=$1", [req.params.id]);

    if (result.rows.length === 0) return res.send("Batch not found");

    const batch = result.rows[0];
    const orders = batch.data;

    // SKU aggregation
    const skuMap = {};

    orders.forEach(order => {
      order.line_items.forEach(item => {
        const sku = item.sku || "NO-SKU";
        if (!skuMap[sku]) {
          skuMap[sku] = {
            name: item.name,
            qty: 0
          };
        }
        skuMap[sku].qty += item.quantity;
      });
    });

    let html = `
    <style>
      body { font-family:sans-serif; padding:20px; }
      table { width:100%; border-collapse:collapse; }
      th, td { border:1px solid #ddd; padding:10px; text-align:left; }
      th { background:#008060; color:white; }
    </style>

    <h1>${batch.name}</h1>
    <a href="/batches">← Back</a><br/><br/>

    <table>
      <tr>
        <th>SKU</th>
        <th>Product</th>
        <th>Total Qty</th>
      </tr>
    `;

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

  } catch (err) {
    res.send("Error loading picklist");
  }
});

// ================= START SERVER =================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 App running on port ${PORT}`);
});
