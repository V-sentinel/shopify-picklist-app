const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

app.get('/orders', async (req, res) => {
  const shop = process.env.SHOP_NAME;
  const token = process.env.SHOPIFY_API_KEY;

  if (!shop || !token) {
    return res.status(500).json({ error: 'Missing SHOP_NAME or SHOPIFY_API_KEY in Railway variables' });
  }

  try {
    const response = await fetch(
      `https://${shop}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled&limit=50`,
      { headers: { 'X-Shopify-Access-Token': token } }
    );
    const data = await response.json();

    if (data.errors) {
      return res.status(401).json({ error: data.errors });
    }

    res.json(data.orders || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`App running on port ${PORT}`));
