const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

// ================= ENV =================
const SHOP = process.env.SHOPIFY_STORE;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

// ================= CACHE =================
let cachedToken = null;
let tokenExpiry = 0;

// ================= GET ACCESS TOKEN =================
async function getAccessToken() {
  // Return cached token if it's still valid (with a 1-minute safety buffer)
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  // Shopify expects x-www-form-urlencoded for this endpoint
  const response = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(JSON.stringify(data));
  }

  // Cache the token and set the expiry timestamp
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);

  return cachedToken;
}

// ================= VALIDATION =================
if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ Missing ENV variables");

  app.get("/", (req, res) => {
    res.send(`
      <h2 style="color:red;">Configuration Error</h2>
      <pre>
SHOPIFY_STORE=your-store.myshopify.com
SHOPIFY_CLIENT_ID=xxxx
SHOPIFY_CLIENT_SECRET=xxxx
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
      const token = await getAccessToken();

      // Updated API version to 2026-01
      const response = await fetch(
        `https://${SHOP}/admin/api/2026-01/orders.json?status=unfulfilled&limit=20`,
        {
          headers: {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json"
          }
        }
      );

      const data = await response.json();

      if (data.errors) {
        return res.send(`<pre>${JSON.stringify(data.errors)}</pre>`);
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
      res.send(`<pre>${err.message}</pre>`);
    }
  });

}

// ================= START =================
app.listen(PORT, () => {
  console.log("🚀 App running on port " + PORT);
});
