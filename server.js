import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// ================= 1. ENV CONFIG & FIXER =================
// This handles both naming conventions and fixes the URL automatically
const RAW_SHOP = process.env.SHOP_NAME || process.env.SHOPIFY_STORE;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

// Automatically appends .myshopify.com if it's missing
const SHOP = RAW_SHOP?.includes(".") ? RAW_SHOP : `${RAW_SHOP}.myshopify.com`;

// ================= 2. TOKEN CACHE =================
let cachedToken = null;
let tokenExpiry = 0;

// ================= 3. MODERN AUTH LOGIC =================
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

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
    // Set expiry based on Shopify's response (usually 24 hours)
    tokenExpiry = Date.now() + (data.expires_in * 1000);
    return cachedToken;
  } else {
    throw new Error(`Auth Failed: ${data.error_description || JSON.stringify(data)}`);
  }
}

// ================= 4. ROUTES =================

// Health check / Favicon fix
app.get('/favicon.ico', (req, res) => res.status(204));

// Validation Middleware
const configCheck = (req, res, next) => {
  if (!RAW_SHOP || !CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).send("<h1>Configuration Error</h1><p>Check your Environment Variables.</p>");
  }
  next();
};

app.get("/", configCheck, (req, res) => {
  res.send(`
    <div style="font-family:sans-serif; padding:20px;">
      <h1>📦 Picklist App</h1>
      <p>Connected to: <b>${SHOP}</b></p>
      <a href="/orders" style="padding:10px 20px; background:#008060; color:white; text-decoration:none; border-radius:5px;">View Orders</a>
    </div>
  `);
});

app.get("/orders", configCheck, async (req, res) => {
  try {
    const token = await getAccessToken();

    // Using the latest stable API version
    const response = await fetch(
      `https://${SHOP}/admin/api/2025-01/orders.json?status=unfulfilled&limit=20`,
      {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();

    if (data.errors) throw new Error(JSON.stringify(data.errors));

    let html = `<div style="font-family:sans-serif; padding:20px;">
                  <h1>Unfulfilled Orders</h1>
                  <a href="/">← Back</a><br><br>`;

    if (!data.orders || data.orders.length === 0) {
      html += "<p>No unfulfilled orders found.</p>";
    } else {
      data.orders.forEach(order => {
        html += `
          <div style="border:1px solid #dfe3e8; padding:15px; margin-bottom:10px; border-radius:8px;">
            <b style="font-size:1.2em;">Order ${order.name}</b><br>
            <span style="color:#637381;">Items: ${order.line_items.length}</span>
          </div>`;
      });
    }

    res.send(html + "</div>");

  } catch (err) {
    res.status(500).send(`<pre style="color:red;">Error: ${err.message}</pre>`);
  }
});

// ================= 5. START =================
app.listen(PORT, () => {
  console.log(`🚀 Modern Shopify App running on port ${PORT}`);
  console.log(`🏠 Target Store: ${SHOP}`);
});
