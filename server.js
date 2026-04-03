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

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET || !DATABASE_URL) {
  console.error("❌ Missing required environment variables!");
  process.exit(1);
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= DATABASE =================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize Database
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id SERIAL PRIMARY KEY,
        name TEXT,
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Database Table Ready");
  } catch (err) {
    console.error("❌ DB Initialization Error:", err.message);
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
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials"
    })
  });

  const data = await response.json();
  if (!data.access_token) {
    console.error("❌ Shopify Auth Error:", data);
    throw new Error("Token generation failed. Check your SHOP_NAME, CLIENT_ID and CLIENT_SECRET.");
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3500 * 1000; // ~1 hour with buffer
  return cachedToken;
}

// ================= FETCH ORDERS =================
async function getOrders() {
  const token = await getAccessToken();
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled&limit=50`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  const data = await response.json();
  return data.orders || [];
}

async function getOrdersByIds(ids) {
  const token = await getAccessToken();
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?ids=${ids.join(",")}`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  const data = await response.json();
  return data.orders || [];
}

// ================= ROUTES =================
app.get("/", (req, res) => res.redirect("/orders"));

// ORDERS PAGE - Beautiful UI
app.get("/orders", async (req, res) => {
  try {
    const orders = await getOrders();
    const search = (req.query.search || "").toLowerCase();

    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Picklist • ${SHOP}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
      <style>
        body { font-family: system-ui, sans-serif; }
        .card { transition: all 0.2s; }
        .card:hover { transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); }
      </style>
    </head>
    <body class="bg-gray-50">
      <div class="max-w-6xl mx-auto p-6">
        <div class="flex justify-between items-center mb-8">
          <h1 class="text-4xl font-bold text-gray-800 flex items-center gap-3">
            📦 Picklist Generator
          </h1>
          <a href="/batches" class="flex items-center gap-2 text-emerald-600 hover:text-emerald-700 font-medium">
            <i class="fas fa-list"></i> View Saved Picklists
          </a>
        </div>

        <form method="POST" action="/create-batch" id="orderForm">
          <div class="flex gap-4 mb-6">
            <input type="text" id="searchInput" placeholder="🔎 Search orders or customers..." 
                   class="flex-1 px-4 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:border-emerald-500">
            <button type="button" onclick="selectAll()" 
                    class="px-6 py-3 bg-white border border-gray-300 rounded-2xl hover:bg-gray-50 font-medium">
              Select All
            </button>
            <button type="submit" 
                    class="px-8 py-3 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 font-semibold flex items-center gap-2">
              <i class="fas fa-plus"></i> Create Picklist
            </button>
          </div>

          <div class="grid gap-4" id="ordersContainer">
    `;

    const filteredOrders = orders.filter(order => 
      !search || 
      order.name.toLowerCase().includes(search) ||
      (order.customer?.first_name + " " + order.customer?.last_name).toLowerCase().includes(search)
    );

    if (filteredOrders.length === 0) {
      html += `<p class="text-gray-500 text-center py-12">No unfulfilled orders found.</p>`;
    } else {
      filteredOrders.forEach(order => {
        const customer = order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : "No customer";
        const totalItems = order.line_items.reduce((sum, i) => sum + i.quantity, 0);
        const totalPrice = order.total_price_set?.shop_money?.amount || "0.00";

        html += `
        <div class="card bg-white border border-gray-200 rounded-3xl p-6 flex items-center gap-6">
          <input type="checkbox" name="orders" value="${order.id}" class="w-5 h-5 accent-emerald-600">
          <div class="flex-1">
            <div class="flex items-center justify-between">
              <strong class="text-xl">${order.name}</strong>
              <span class="text-emerald-600 font-medium">₹${totalPrice}</span>
            </div>
            <p class="text-gray-600">${customer} • ${new Date(order.created_at).toLocaleDateString('en-IN')}</p>
            <div class="flex flex-wrap gap-2 mt-3">
              ${order.line_items.map(item => 
                `<span class="text-xs bg-gray-100 px-3 py-1 rounded-xl">${item.sku || "NO-SKU"} × ${item.quantity}</span>`
              ).join("")}
            </div>
          </div>
          <div class="text-right">
            <div class="text-2xl font-semibold text-gray-800">${totalItems}</div>
            <div class="text-xs text-gray-500">ITEMS</div>
          </div>
        </div>`;
      });
    }

    html += `
          </div>
        </form>
      </div>

      <script>
        function selectAll() {
          const checkboxes = document.querySelectorAll('input[type="checkbox"]');
          const allChecked = Array.from(checkboxes).every(cb => cb.checked);
          checkboxes.forEach(cb => cb.checked = !allChecked);
        }

        // Live search
        document.getElementById('searchInput').addEventListener('input', function(e) {
          const term = e.target.value.toLowerCase();
          const cards = document.querySelectorAll('.card');
          cards.forEach(card => {
            const text = card.textContent.toLowerCase();
            card.style.display = text.includes(term) ? 'flex' : 'none';
          });
        });
      </script>
    </body>
    </html>`;

    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send(`<h1 class="text-red-600 p-10">Error loading orders: ${err.message}</h1>`);
  }
});

// CREATE BATCH
app.post("/create-batch", async (req, res) => {
  try {
    let orderIds = req.body.orders;
    if (!orderIds) return res.send(`<script>alert("Please select at least one order"); window.history.back();</script>`);
    if (!Array.isArray(orderIds)) orderIds = [orderIds];

    const fullOrders = await getOrdersByIds(orderIds);
    const batchName = `Batch-${new Date().toLocaleString('en-IN', { hour12: true })}`;

    await pool.query(
      "INSERT INTO batches (name, data) VALUES ($1, $2)",
      [batchName, JSON.stringify(fullOrders)]
    );

    res.redirect("/batches");
  } catch (err) {
    console.error("Create Batch Error:", err);
    res.status(500).send("Database Error: " + err.message);
  }
});

// VIEW ALL BATCHES
app.get("/batches", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM batches ORDER BY created_at DESC");
    let html = `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><title>Saved Picklists</title>
    <script src="https://cdn.tailwindcss.com"></script></head>
    <body class="bg-gray-50 p-8">
      <div class="max-w-4xl mx-auto">
        <h1 class="text-4xl font-bold mb-6">📋 Saved Picklists</h1>
        <a href="/orders" class="text-emerald-600 hover:underline mb-8 inline-flex items-center gap-2">
          ← Back to Orders
        </a>
    `;

    if (result.rows.length === 0) {
      html += `<p class="text-gray-500">No picklists saved yet.</p>`;
    } else {
      result.rows.forEach(batch => {
        html += `
        <div class="bg-white rounded-3xl p-6 mb-4 flex justify-between items-center border border-gray-100">
          <div>
            <strong class="text-xl">${batch.name}</strong><br>
            <span class="text-gray-500 text-sm">${new Date(batch.created_at).toLocaleString('en-IN')}</span>
          </div>
          <div class="flex gap-3">
            <a href="/batch/${batch.id}" class="px-6 py-3 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700">View Picklist</a>
            <form action="/delete-batch/${batch.id}" method="POST" onsubmit="return confirm('Delete this batch?')">
              <button type="submit" class="px-6 py-3 bg-red-100 text-red-600 rounded-2xl hover:bg-red-200">Delete</button>
            </form>
          </div>
        </div>`;
      });
    }

    html += `</div></body></html>`;
    res.send(html);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// DELETE BATCH
app.post("/delete-batch/:id", async (req, res) => {
  await pool.query("DELETE FROM batches WHERE id = $1", [req.params.id]);
  res.redirect("/batches");
});

// VIEW SINGLE PICKLIST (Print friendly)
app.get("/batch/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM batches WHERE id=$1", [req.params.id]);
    if (result.rows.length === 0) return res.send("Batch not found");

    const orders = result.rows[0].data;
    const skuMap = {};

    orders.forEach(order => {
      order.line_items.forEach(item => {
        const sku = item.sku || "NO-SKU";
        if (!skuMap[sku]) skuMap[sku] = { name: item.name, qty: 0 };
        skuMap[sku].qty += item.quantity;
      });
    });

    const sortedSKUs = Object.keys(skuMap).sort();

    let html = `
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><title>Picklist #${req.params.id}</title>
    <script src="https://cdn.tailwindcss.com"></script></head>
    <body class="bg-white p-8 max-w-4xl mx-auto">
      <div class="flex justify-between items-center mb-8">
        <h1 class="text-4xl font-bold">📦 Picklist</h1>
        <button onclick="window.print()" class="px-8 py-4 bg-emerald-600 text-white rounded-3xl font-semibold flex items-center gap-2 hover:bg-emerald-700">
          🖨️ Print / Save as PDF
        </button>
      </div>
      <p class="text-gray-500 mb-8">${result.rows[0].name}</p>

      <table class="w-full border-collapse border border-gray-300">
        <thead>
          <tr class="bg-gray-100">
            <th class="border border-gray-300 px-6 py-4 text-left">SKU</th>
            <th class="border border-gray-300 px-6 py-4 text-left">Product Name</th>
            <th class="border border-gray-300 px-6 py-4 text-center">Total Qty</th>
          </tr>
        </thead>
        <tbody>
    `;

    let grandTotal = 0;
    sortedSKUs.forEach(sku => {
      const qty = skuMap[sku].qty;
      grandTotal += qty;
      html += `
      <tr>
        <td class="border border-gray-300 px-6 py-4 font-mono">${sku}</td>
        <td class="border border-gray-300 px-6 py-4">${skuMap[sku].name}</td>
        <td class="border border-gray-300 px-6 py-4 text-center font-bold">${qty}</td>
      </tr>`;
    });

    html += `
        </tbody>
        <tfoot>
          <tr class="bg-emerald-50">
            <td colspan="2" class="border border-gray-300 px-6 py-4 text-right font-bold">TOTAL ITEMS TO PICK</td>
            <td class="border border-gray-300 px-6 py-4 text-center text-2xl font-bold">${grandTotal}</td>
          </tr>
        </tfoot>
      </table>

      <div class="mt-12 text-center text-gray-400 text-sm">
        Generated on ${new Date().toLocaleString('en-IN')}
      </div>
    </body></html>`;

    res.send(html);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Picklist app running on port ${PORT}`);
});
