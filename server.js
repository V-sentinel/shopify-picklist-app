app.get("/orders", async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(
      `https://${SHOP}.myshopify.com/admin/api/2024-04/orders.json?status=unfulfilled&limit=50`,
      { headers: { "X-Shopify-Access-Token": token } }
    );

    const data = await response.json();
    
    // SAFE CHECK: Ensure orders exists before we use it
    const orders = data.orders || [];

    if (orders.length === 0) {
        return res.send(`
            <div style="font-family:sans-serif; padding:40px; text-align:center;">
                <h1>✅ All caught up!</h1>
                <p>No unfulfilled orders found.</p>
                <a href="/">Go Back</a>
            </div>
        `);
    }

    // Now it is safe to build the HTML because 'orders' is defined
    let html = `
      <style>
        :root { --primary: #008060; --bg: #f6f6f7; --text: #202223; }
        body { font-family: -apple-system, sans-serif; background: var(--bg); color: var(--text); padding: 20px; }
        .order-card { background: white; border-radius: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid #e1e3e5; shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .item-row { display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid #f1f2f3; }
        .sku { display: block; font-size: 0.75rem; color: #6d7175; }
        .btn-fulfill { background: var(--primary); color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; margin-top: 15px; }
      </style>
      <h1>📦 Picklist (${orders.length} Orders)</h1>`;

    orders.forEach(order => {
      html += `
        <div class="order-card">
          <h3>Order ${order.name}</h3>
          ${order.line_items.map(item => `
            <div class="item-row">
              <input type="checkbox" style="width:20px; height:20px; margin-right:15px;">
              <div>
                <span class="sku">${item.sku || 'NO SKU'}</span>
                <strong>${item.quantity}x</strong> ${item.title}
              </div>
            </div>
          `).join('')}
          <form action="/fulfill/${order.id}" method="POST">
            <button type="submit" class="btn-fulfill">Mark as Fulfilled</button>
          </form>
        </div>`;
    });

    res.send(html);

  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).send("Error loading orders: " + err.message);
  }
});
