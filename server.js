import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// ================= 1. ENV CONFIG =================
const RAW_SHOP = process.env.SHOP_NAME || process.env.SHOPIFY_STORE;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOP = RAW_SHOP?.includes(".") ? RAW_SHOP : `${RAW_SHOP}.myshopify.com`;

// ================= 2. TOKEN CACHE =================
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;

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
  if (data.access_token) {
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000);
    return cachedToken;
  }
  throw new Error("Auth Failed");
}

// ================= 3. ROUTES =================

app.get("/", (req, res) => {
  res.send(`
    <div style="font-family:sans-serif; padding:20px;">
      <h1>📦 Picklist App</h1>
      <a href="/orders" style="display:block; margin-bottom:10px;">View Orders</a>
      <form action="/create-test-order" method="POST">
        <button type="submit" style="background:#008060; color:white; border:none; padding:10px; cursor:pointer; border-radius:5px;">
          Create Test Order
        </button>
      </form>
    </div>
  `);
});

// NEW ROUTE: Create an Order
app.post("/create-test-order", async (req, res) => {
  try {
    const token = await getAccessToken();

    const response = await fetch(`https://${SHOP}/admin/api/2025-01/orders.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order: {
          line_items: [
            {
              title: "Test Item",
              price: "10.00",
              quantity: 1
            }
          ]
        }
      }),
    });

    const data = await response.json();

    if (data.errors) throw new Error(JSON.stringify(data.errors));

    res.send(`<h1>Order Created!</h1><p>Order ID: ${data.order.id}</p><a href="/">Back</a>`);
  } catch (err) {
    res.status(500).send(`<pre>Error: ${err.message}</pre><a href="/">Back</a>`);
  }
});

app.get("/orders", async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(`https://${SHOP}/admin/api/2025-01/orders.json?status=any&limit=10`, {
      headers: { "X-Shopify-Access-Token": token }
    });
    const data = await response.json();

    let html = "<h1>Orders</h1><a href='/'>Back</a><br><br>";
    data.orders.forEach(o => {
      html += `<div style="border:1px solid #ccc; padding:10px; margin:10px;"><b>#${o.order_number}</b></div>`;
    });
    res.send(html);
  } catch (err) {
    res.send(err.message);
  }
});

app.listen(PORT, () => console.log(`🚀 Running on ${PORT}`));
