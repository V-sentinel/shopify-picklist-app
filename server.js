const express = require('express');
const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
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

app.get('/orders', async (req, res) => {
  const shop = process.env.SHOP_NAME;
  const token = process.env.SHOPIFY_API_KEY;
  const data = await response.json();

  if (!shop || !token) {
    return res.status(500).json({ error: 'Missing SHOP_NAME or SHOPIFY_API_KEY in Railway variables' });
  if (!data.access_token) {
    throw new Error("Token request failed: " + JSON.stringify(data));
}

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;

  return cachedToken;
}

app.get("/orders", async (req, res) => {
try {
    const token = await getAccessToken();

const response = await fetch(
      `https://${shop}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled&limit=50`,
      { headers: { 'X-Shopify-Access-Token': token } }
      `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled&limit=50`,
      {
        headers: {
          "X-Shopify-Access-Token": token,
        },
      }
);
    const data = await response.json();

    if (data.errors) {
      return res.status(401).json({ error: data.errors });
    }
    const data = await response.json();

res.json(data.orders || []);
} catch (err) {
res.status(500).json({ error: err.message });
}
});

app.listen(PORT, () => console.log(`App running on port ${PORT}`));
app.listen(PORT, () => console.log("Server running"));
