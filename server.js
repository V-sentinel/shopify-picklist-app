const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', async (req, res) => {
  const shop = process.env.SHOP_NAME;
  const token = process.env.SHOPIFY_API_KEY;

  try {
    // We updated the version here to 2024-04
    const response = await fetch(`https://${shop}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled`, {
      headers: { 'X-Shopify-Access-Token': token }
    });
    
    const data = await response.json();

    // Check if the gatekeeper (Shopify) rejected us
    if (data.errors) {
      return res.send(`<h1>Shopify Error</h1><p>${JSON.stringify(data.errors)}</p>`);
    }

    // Check if there are actually any orders to show
    if (!data.orders || data.orders.length === 0) {
      return res.send("<h1>Warehouse Picklist</h1><p>No unfulfilled orders found. Go create a test order!</p>");
    }
    
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
    res.status(500).send("The app couldn't find your store. Check your SHOP_NAME variable in Railway.");
  }
});

app.listen(PORT, () => console.log(`App is live!`));
