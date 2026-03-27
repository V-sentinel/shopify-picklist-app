const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', async (req, res) => {
  const shop = process.env.SHOP_NAME;
  const token = process.env.SHOPIFY_API_KEY;

  try {
    const response = await fetch(`https://${shop}.myshopify.com/admin/api/2024-01/orders.json?status=unfulfilled`, {
      headers: { 'X-Shopify-Access-Token': token }
    });
    const data = await response.json();
    
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
