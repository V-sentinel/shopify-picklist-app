// Replace the HTML section in your /orders route with this:

    let html = `
      <style>
        :root { --primary: #008060; --bg: #f6f6f7; --text: #202223; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 20px; }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
        
        .order-card { 
            background: white; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); 
            margin-bottom: 16px; overflow: hidden; border: 1px solid #e1e3e5;
        }
        .order-header { 
            padding: 16px; background: #fafbfb; border-bottom: 1px solid #e1e3e5; 
            display: flex; justify-content: space-between; align-items: center;
        }
        .order-id { font-weight: 700; font-size: 1.1rem; }
        
        .items-list { padding: 8px 16px; }
        .item-row { 
            display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid #f1f2f3; 
        }
        .item-row:last-child { border-bottom: none; }
        
        /* Modern Checkbox */
        .check-container { position: relative; cursor: pointer; padding-left: 35px; flex-grow: 1; }
        .check-container input { position: absolute; opacity: 0; cursor: pointer; }
        .checkmark { 
            position: absolute; top: 0; left: 0; height: 24px; width: 24px; 
            background-color: #eee; border-radius: 6px; border: 2px solid #ccc;
        }
        .check-container:hover input ~ .checkmark { background-color: #ddd; }
        .check-container input:checked ~ .checkmark { background-color: var(--primary); border-color: var(--primary); }
        .checkmark:after {
            content: ""; position: absolute; display: none;
            left: 8px; top: 4px; width: 5px; height: 10px;
            border: solid white; border-width: 0 3px 3px 0; transform: rotate(45deg);
        }
        .check-container input:checked ~ .checkmark:after { display: block; }
        .check-container input:checked + .item-details { text-decoration: line-through; opacity: 0.6; }

        .sku { display: block; font-size: 0.8rem; color: #6d7175; text-transform: uppercase; letter-spacing: 0.5px; }
        .qty { font-weight: bold; margin-right: 10px; color: var(--primary); }
        
        .footer-action { padding: 16px; background: #fdfdfd; text-align: right; }
        .btn-fulfill { 
            background: var(--primary); color: white; border: none; padding: 10px 24px; 
            border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s;
        }
        .btn-fulfill:hover { background: #006e52; }
      </style>

      <div class="header">
        <h1>📦 Picklist</h1>
        <span>${orders.length} Orders Pending</span>
      </div>`;

    orders.forEach(order => {
      html += `
        <div class="order-card">
          <div class="order-header">
            <span class="order-id">Order ${order.name}</span>
            <span class="badge">${order.line_items.length} items</span>
          </div>
          
          <div class="items-list">
            ${order.line_items.map(item => `
              <div class="item-row">
                <label class="check-container">
                  <input type="checkbox">
                  <span class="checkmark"></span>
                  <div class="item-details">
                    <span class="sku">${item.sku || 'NO SKU'}</span>
                    <span class="qty">${item.quantity}x</span> ${item.title}
                  </div>
                </label>
              </div>
            `).join('')}
          </div>

          <div class="footer-action">
            <form action="/fulfill/${order.id}" method="POST" onsubmit="return confirm('Ready to fulfill ${order.name}?')">
              <button type="submit" class="btn-fulfill">Complete Fulfillment</button>
            </form>
          </div>
        </div>`;
    });
