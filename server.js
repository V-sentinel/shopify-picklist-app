const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

const SHOP = process.env.SHOP_NAME;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`,
    }
  );

  const data = await response.json();

  if (!data.access_token) {
    throw new Error("Token request failed: " + JSON.stringify(data));
  }

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;

  return cachedToken;
}
app.get("/", (req, res) => {
  res.send(`
    <h1>📦 Picklist App is working</h1>
    <p><a href="/orders">Click here to view unfulfilled orders</a></p>
  `);
});

app.get("/orders", async (req, res) => {
  try {
    const token = await getAccessToken();

    const response = await fetch(
      `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled&limit=50`,
      {
        headers: {
          "X-Shopify-Access-Token": token,
        },
      }
    );

    const data = await response.json();
    const orders = data.orders || [];

    if (!orders.length) {
      return res.send("<h2>✅ No unfulfilled orders right now</h2>");
    }

    let html = `
      <h1>📦 Warehouse Picklist</h1>
      <style>
        body { font-family: Arial; padding:20px; }
        .order { margin-bottom:25px; }
        .item { margin-left:15px; }
      </style>
    `;

    orders.forEach(order => {
      html += `<div class="order"><h3>${order.name}</h3>`;

      order.line_items.forEach(item => {
        html += `
          <div class="item">
            <input type="checkbox">
            ${item.quantity} × ${item.title}
          </div>
        `;
      });

      html += `</div>`;
    });

    res.send(html);

  } catch (err) {
    res.status(500).send("Error loading picklist: " + err.message);
  }
});
