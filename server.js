const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', async (req, res) => {
  const shop = process.env.SHOP_NAME;
  const token = process.env.SHOPIFY_API_KEY;

  if (!shop || !token) {
    return res.status(500).send(
      "Missing configuration: ensure SHOP_NAME and SHOPIFY_API_KEY environment variables are set."
    );
  }

  try {
    const response = await fetch(
      `https://${shop}.myshopify.com/admin/api/2024-01/orders.json?status=unfulfilled`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );

    if (!response.ok) {
      return res.status(response.status).send(
        `Shopify API request failed (HTTP ${response.status}). ` +
        `Check that SHOP_NAME ("${shop}") and SHOPIFY_API_KEY are correct.`
      );
    }

    const data = await response.json();

    // Shopify returns an errors object when credentials are invalid
    if (data.errors) {
      return res.status(401).send(
        `Shopify API error: ${JSON.stringify(data.errors)}. ` +
        `Verify your SHOPIFY_API_KEY token and that it has the correct permissions.`
      );
    }

    if (!data.orders || data.orders.length === 0) {
      return res.send("<h1>Warehouse Picklist</h1><p>No unfulfilled orders at this time.</p>");
    }

    // Simple HTML display
    let html = "<h1>Warehouse Picklist</h1><ul>";
    data.orders.forEach(order => {
      html += `<li><strong>Order ${order.name}</strong>: `;
      order.line_items.forEach(item => {
        html += `${item.quantity}x ${item.title} | `;
      });
      html += "</li>";
    });
    html += "</ul>";

    res.send(html);
  } catch (error) {
    res.status(500).send("Error fetching orders: " + error.message);
  }
});

app.listen(PORT, () => console.log(`App running on port ${PORT}`));
