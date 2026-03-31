const express = require("express");
const fetch = require("node-fetch");
const app = express();

// 1. CONFIGURATION
// These MUST be set in Railway's "Variables" tab
const SHOP = process.env.SHOP_NAME;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const PORT = process.env.PORT || 3000;

let cachedToken = null;
let tokenExpiry = 0;

// 2. ACCESS TOKEN LOGIC (OAuth Client Credentials)
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const response = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`,
  });

  const data = await response.json();
  if (!data.access_token) throw new Error("Token failure: " + JSON.stringify(data));

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
  return cachedToken;
}

// 3. HOME ROUTE
app.get("/", (req, res) => {
  res.send(`
    <div style="font-family:sans-serif; text-align:center; padding:50px;">
      <h1>📦 Picklist App</h1>
      <p>Status: Online</p>
      <a href="/orders" style="background:#008060; color:white; padding:10px 20px; text-decoration:none; border-radius:5px;">View Orders</a>
    </div>
  `);
});

// 4. PICKLIST ROUTE (The Fixed Version)
app.get("/orders", async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(
      `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled&limit=50`,
      { headers: { "X-Shopify-Access-Token": token } }
    );

    const data = await response.json();
    const orders = data.orders || []; // Ensure orders is defined even if empty

    if (orders.length === 0) {
      return res.send(`
        <div style="font-family:sans-serif; padding:40px; text-align:center;">
          <h1>✅ All caught up!</h1>
          <a href="/">Go Back</a>
        </div>
      `);
    }

    // Build the "Pickify" Style UI
    let html = `
      <style>
        :root { --primary: #008060; --bg: #f6f6f7; --text: #202223; }
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .order-card { background: white; border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #e1e3e5; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .item-row { display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid #f1f2f3; }
        .item-row:last-child { border-bottom: none; }
        .sku { display: block; font-size: 0.8rem; color: #6d7175; font-weight: bold; }
        .qty { color: var(--primary); font-weight: bold; margin-right: 8px; }
        .btn-fulfill { background: var(--primary); color: white; border: none; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; width: 100%; margin-top: 15px; }
        input[type="checkbox"] { width: 22px; height: 22px; margin-right: 15px; cursor: pointer; }
      </style>
      <div class="header">
        <h1>📦 Warehouse Picklist</h1>
        <span>${orders.length} Orders</span>
      </div>`;

    orders.forEach(order => {
      html += `
        <div class="order-card">
          <h3>Order ${order.name}</h3>
          ${order.line_items.map(item => `
            <div class="item-row">
              <input type="checkbox">
              <div>
                <span class="sku">${item.sku || 'NO SKU'}</span>
                <span class="qty">${item.quantity}x</span> ${item.title}
              </div>
            </div>
          `).join('')}
          <form action="/fulfill/${order.id}" method="POST">
            <button type="submit" class="btn-fulfill">Mark as Fulfilled</button>
          </form>
        </div>`;
    });

    res.send(html);

  } catch (err) {
    console.error(err);
    res.status(500).send("Error: " + err.message);
  }
});

// 5. START SERVER
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});
