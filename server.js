const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= ENV =================
const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

// ================= VALIDATION =================
if (!SHOP || !TOKEN) {
  console.error("❌ Missing SHOPIFY_STORE or SHOPIFY_ACCESS_TOKEN");

  app.get("/", (req, res) => {
    res.send(`
      <h2 style="color:red;">Configuration Error</h2>
      <p>Missing Shopify variables</p>
      <pre>
SHOPIFY_STORE=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxx
      </pre>
    `);
  });
} else {

// ================= HOME =================
app.get("/", (req, res) => {
  res.send(`
    <h1>📦 Picklist App</h1>
    <a href="/orders">View Orders</a>
  `);
});

// ================= FETCH ORDERS =================
app.get("/orders", async (req, res) => {
  try {
    const response = await fetch(
      `https://${SHOP}/admin/api/2024-04/orders.json?status=unfulfilled&limit=20`,
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();

    if (data.errors) {
      return res.send(`
        <h2 style="color:red;">Shopify Error</h2>
        <pre>${JSON.stringify(data.errors)}</pre>
      `);
    }

    let html = "<h1>Orders</h1><a href='/'>Back</a><br><br>";

    data.orders.forEach(order => {
      html += `
        <div style="border:1px solid #ccc; padding:10px; margin:10px;">
          <b>Order #${order.order_number}</b><br>
          Items: ${order.line_items.length}
        </div>
      `;
    });

    res.send(html);

  } catch (err) {
    res.send(`
      <h2 style="color:red;">Error</h2>
      <pre>${err.message}</pre>
    `);
  }
});

}

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 App running on port " + PORT);
});
