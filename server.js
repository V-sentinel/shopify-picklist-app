import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// ================= ENV =================
const SHOP = process.env.SHOPIFY_STORE;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

// ================= CACHE =================
let cachedToken = null;
let tokenExpiry = 0;

// ================= FAVICON FIX =================
app.get('/favicon.ico', (req, res) => res.status(204));
app.get('/favicon.png', (req, res) => res.status(204));

// ================= GET ACCESS TOKEN =================
async function getAccessToken() {
  try {
    if (cachedToken && Date.now() < tokenExpiry - 60000) {
      return cachedToken;
    }

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

    console.log("TOKEN RESPONSE:", data); // 🔥 DEBUG

    if (!data.access_token) {
      throw new Error("Token not received: " + JSON.stringify(data));
    }

    cachedToken = data.access_token;
    tokenExpiry = Date.now() + ((data.expires_in || 3600) * 1000);

    return cachedToken;

  } catch (err) {
    console.error("TOKEN ERROR:", err.message);
    throw err;
  }
}

// ================= VALIDATION =================
if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {

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

      console.log("ORDERS RESPONSE:", data); // 🔥 DEBUG

      if (data.errors) {
        return res.send(`<pre>${JSON.stringify(data.errors)}</pre>`);
      }

      let html = "<h1>Orders</h1><a href='/'>Back</a><br><br>";

      data.orders?.forEach(order => {
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
