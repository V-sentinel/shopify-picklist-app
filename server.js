const express = require("express");
const fetch = require("node-fetch");
const app = express();
const PORT = process.env.PORT || 3000;

// Config (Ensure these are in your Environment Variables)
const SHOP = process.env.SHOP_NAME;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

let cachedToken = null;
let tokenExpiry = 0;

// OAuth Client Credentials Flow
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

app.get("/", (req, res) => {
  res.send('<h1>📦 Picklist App</h1><a href="/orders">View Unfulfilled Orders</a>');
});

// 1. DISPLAY PICKLIST
app.get("/orders", async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(
      `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled&limit=50`,
      { headers: { "X-Shopify-Access-Token": token } }
    );

    const { orders } = await response.json();

    if (!orders || orders.length === 0) return res.send("<h2>✅ All caught up!</h2>");

    let html = `
      <style>
        body { font-family: sans-serif; padding: 20px; line-height: 1.6; }
        .order-card { border: 1px solid #ccc; padding: 15px; margin-bottom: 20px; border-radius: 8px; }
        .item { margin: 5px 0 5px 20px; }
        .sku { font-weight: bold; color: #555; }
        button { background: #008060; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer; }
      </style>
      <h1>📦 Warehouse Picklist</h1>`;

    orders.forEach(order => {
      html += `
        <div class="order-card">
          <h3>Order ${order.name}</h3>
          ${order.line_items.map(item => `
            <div class="item">
              <input type="checkbox"> 
              <span class="sku">[${item.sku || 'No SKU'}]</span> ${item.quantity}x ${item.title}
            </div>
          `).join('')}
          <br>
          <form action="/fulfill/${order.id}" method="POST">
            <button type="submit">Mark as Fulfilled</button>
          </form>
        </div>`;
    });

    res.send(html);
  } catch (err) {
    res.status(500).send("Error: " + err.message);
  }
});

// 2. FULFILLMENT ACTION
app.post("/fulfill/:order_id", async (req, res) => {
  try {
    const token = await getAccessToken();
    const orderId = req.params.order_id;

    // First, get the Location ID (Shopify requires this to fulfill)
    const locRes = await fetch(`https://${SHOP}.myshopify.com/admin/api/2024-04/locations.json`, {
        headers: { "X-Shopify-Access-Token": token }
    });
    const locData = await locRes.json();
    const locationId = locData.locations[0].id;

    // Create fulfillment
    await fetch(`https://${SHOP}.myshopify.com/admin/api/2024-04/fulfillments.json`, {
      method: "POST",
      headers: { 
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fulfillment: {
          location_id: locationId,
          tracking_info: { number: "12345", company: "Internal" },
          line_items_by_fulfillment_order: [
            { fulfillment_order_id: orderId } // Simplified for this example
          ]
        }
      })
    });

    res.redirect("/orders");
  } catch (err) {
    res.status(500).send("Fulfillment Error: " + err.message);
  }
});

app.listen(PORT, () => console.log(`App running on port ${PORT}`));
