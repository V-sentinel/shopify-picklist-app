import express from "express";
import fetch from "node-fetch";
import { Pool } from "pg";

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const SHOP = (process.env.SHOP_NAME || "").trim();
const CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL;

console.log("🚀 Starting Picklist App (ESM Version)...");
console.log("SHOP_NAME:", SHOP ? "✅" : "❌ MISSING");
console.log("CLIENT_ID:", CLIENT_ID ? "✅" : "❌ MISSING");
console.log("CLIENT_SECRET:", CLIENT_SECRET ? "✅" : "❌ MISSING");
console.log("DATABASE_URL:", DATABASE_URL ? "✅ Found" : "❌ MISSING");

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ Missing Shopify credentials in Render Environment Variables");
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================= DATABASE =================
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 8,
}) : null;

async function initDB() {
  if (!pool) {
    console.warn("⚠️ No DATABASE_URL - Database disabled");
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS picklists (
        id SERIAL PRIMARY KEY,
        order_name TEXT UNIQUE,
        order_data JSONB,
        picklist_data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Database Ready");
  } catch (err) {
    console.error("❌ DB Error:", err.message);
  }
}
initDB();

// ================= TOKEN =================
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const response = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  const data = await response.json();
  if (!data.access_token) throw new Error("Failed to get Shopify token");

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 3400000;
  return cachedToken;
}

// ================= HELPER FUNCTIONS =================

async function fetchOrderDetails(orderId) {
  const token = await getAccessToken();
  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/2025-01/orders/${orderId}.json`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  const data = await response.json();
  return data.order;
}

function generatePicklistNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PL-${year}${month}${day}-${random}`;
}

function createPicklistData(order) {
  const items = order.line_items.map(item => ({
    product_id: item.product_id,
    variant_id: item.variant_id,
    sku: item.sku || 'N/A',
    title: item.title,
    variant_title: item.variant_title,
    quantity: item.quantity,
    price: item.price,
    location: item.location_id || null,
    barcode: item.barcode || null,
    grams: item.grams,
    requires_shipping: item.requires_shipping
  }));

  return {
    picklist_number: generatePicklistNumber(),
    created_at: new Date().toISOString(),
    order_info: {
      order_id: order.id,
      order_name: order.name,
      order_number: order.order_number,
      created_at: order.created_at,
      financial_status: order.financial_status,
      fulfillment_status: order.fulfillment_status,
      tags: order.tags,
      note: order.note
    },
    customer: order.customer ? {
      id: order.customer.id,
      name: `${order.customer.first_name} ${order.customer.last_name || ''}`.trim(),
      email: order.customer.email,
      phone: order.customer.phone
    } : null,
    shipping_address: order.shipping_address ? {
      name: order.shipping_address.name,
      address1: order.shipping_address.address1,
      address2: order.shipping_address.address2,
      city: order.shipping_address.city,
      province: order.shipping_address.province,
      zip: order.shipping_address.zip,
      country: order.shipping_address.country
    } : null,
    items: items,
    total_items: items.reduce((sum, item) => sum + item.quantity, 0),
    total_price: order.total_price,
    currency: order.currency,
    status: 'pending',
    notes: ''
  };
}

// ================= ROUTES =================

// 1. Bulk Action → Creates picklist for selected orders
app.get("/bulk-action", async (req, res) => {
  const ids = req.query.ids ? req.query.ids.split(",") : [];
  if (ids.length === 0) return res.redirect("/view-picklists");

  try {
    const picklists = [];
    
    for (const id of ids) {
      const order = await fetchOrderDetails(id);
      if (order) {
        const picklistData = createPicklistData(order);
        
        if (pool) {
          await pool.query(
            `INSERT INTO picklists (order_name, order_data, picklist_data) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (order_name) 
             DO UPDATE SET order_data = $2, picklist_data = $3, updated_at = CURRENT_TIMESTAMP`,
            [order.name, JSON.stringify(order), JSON.stringify(picklistData)]
          );
        }
        picklists.push(picklistData);
      }
    }
    
    // Redirect to the picklist view with the newly created picklists
    const idsParam = picklists.map(p => p.picklist_number).join(',');
    res.redirect(`/view-picklists?highlight=${encodeURIComponent(idsParam)}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating picklist: " + err.message);
  }
});

// 2. View Saved Picklists with detailed view
app.get("/view-picklists", async (req, res) => {
  try {
    if (!pool) return res.send("<h1>Database not connected</h1>");
    const result = await pool.query(
      "SELECT * FROM picklists ORDER BY created_at DESC"
    );
    
    const highlightPicklist = req.query.highlight || '';
    
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Picklist Manager</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background: #f5f5f5;
            padding: 20px;
          }
          .container { max-width: 1400px; margin: 0 auto; }
          .header {
            background: linear-gradient(135deg, #008060 0%, #004c3f 100%);
            color: white;
            padding: 30px;
            border-radius: 12px;
            margin-bottom: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .header h1 { margin-bottom: 10px; }
          .stats {
            display: flex;
            gap: 20px;
            margin-top: 20px;
            flex-wrap: wrap;
          }
          .stat-card {
            background: rgba(255,255,255,0.2);
            padding: 15px 25px;
            border-radius: 8px;
            backdrop-filter: blur(10px);
          }
          .stat-card h3 { font-size: 28px; margin-bottom: 5px; }
          .stat-card p { opacity: 0.9; font-size: 14px; }
          .filters {
            background: white;
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .filters input, .filters select {
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
            margin-right: 10px;
          }
          .picklist-grid {
            display: grid;
            gap: 20px;
          }
          .picklist-card {
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            transition: transform 0.2s, box-shadow 0.2s;
          }
          .picklist-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 16px rgba(0,0,0,0.15);
          }
          .picklist-card.highlight {
            animation: highlight 2s ease;
            border: 2px solid #008060;
          }
          @keyframes highlight {
            0% { background: #fff9c4; }
            100% { background: white; }
          }
          .picklist-header {
            background: #f8f9fa;
            padding: 20px;
            border-bottom: 1px solid #e9ecef;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 10px;
            cursor: pointer;
          }
          .picklist-header h3 {
            color: #008060;
            font-size: 18px;
          }
          .status {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
          }
          .status-pending { background: #ffc107; color: #856404; }
          .status-picking { background: #17a2b8; color: white; }
          .status-packed { background: #28a745; color: white; }
          .status-shipped { background: #007bff; color: white; }
          .picklist-body {
            padding: 20px;
            display: none;
          }
          .picklist-body.open {
            display: block;
          }
          .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
          }
          .info-section {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
          }
          .info-section h4 {
            margin-bottom: 10px;
            color: #495057;
            border-bottom: 2px solid #dee2e6;
            padding-bottom: 5px;
          }
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
          }
          .items-table th,
          .items-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #dee2e6;
          }
          .items-table th {
            background: #f8f9fa;
            font-weight: 600;
            color: #495057;
          }
          .items-table tr:hover {
            background: #f8f9fa;
          }
          .quantity-input {
            width: 70px;
            padding: 5px;
            border: 1px solid #ddd;
            border-radius: 4px;
            text-align: center;
          }
          .action-buttons {
            display: flex;
            gap: 10px;
            margin-top: 20px;
            justify-content: flex-end;
          }
          button {
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
          }
          .btn-primary {
            background: #008060;
            color: white;
          }
          .btn-primary:hover {
            background: #004c3f;
            transform: translateY(-1px);
          }
          .btn-secondary {
            background: #6c757d;
            color: white;
          }
          .btn-secondary:hover {
            background: #5a6268;
          }
          .btn-danger {
            background: #dc3545;
            color: white;
          }
          .btn-danger:hover {
            background: #c82333;
          }
          .btn-success {
            background: #28a745;
            color: white;
          }
          .btn-print {
            background: #17a2b8;
            color: white;
          }
          .notes-area {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 6px;
            margin-top: 10px;
            font-family: inherit;
          }
          @media print {
            body { background: white; padding: 0; }
            .filters, .action-buttons, .picklist-header .status, .btn-print { display: none; }
            .picklist-body { display: block !important; }
            .picklist-card { break-inside: avoid; margin-bottom: 20px; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📦 Picklist Manager</h1>
            <p>Manage and track your order fulfillment picklists</p>
            <div class="stats">
              <div class="stat-card">
                <h3>${result.rows.length}</h3>
                <p>Total Picklists</p>
              </div>
              <div class="stat-card">
                <h3>${result.rows.filter(r => r.picklist_data?.status === 'pending').length}</h3>
                <p>Pending</p>
              </div>
              <div class="stat-card">
                <h3>${result.rows.filter(r => r.picklist_data?.status === 'picking').length}</h3>
                <p>In Progress</p>
              </div>
              <div class="stat-card">
                <h3>${result.rows.filter(r => r.picklist_data?.status === 'packed').length}</h3>
                <p>Packed</p>
              </div>
            </div>
          </div>
          
          <div class="filters">
            <input type="text" id="searchInput" placeholder="🔍 Search by order #, customer, or picklist #..." style="width: 300px;">
            <select id="statusFilter">
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="picking">In Progress</option>
              <option value="packed">Packed</option>
              <option value="shipped">Shipped</option>
            </select>
            <button class="btn-primary" onclick="printSelected()">🖨️ Print Selected</button>
            <button class="btn-secondary" onclick="exportToCSV()">📊 Export to CSV</button>
          </div>
          
          <div class="picklist-grid" id="picklistGrid">
    `;
    
    for (const row of result.rows) {
      const picklist = row.picklist_data || createPicklistData(row.order_data);
      const isHighlight = highlightPicklist.includes(picklist.picklist_number);
      const statusClass = `status-${picklist.status || 'pending'}`;
      
      html += `
        <div class="picklist-card ${isHighlight ? 'highlight' : ''}" data-picklist-id="${picklist.picklist_number}" data-status="${picklist.status || 'pending'}">
          <div class="picklist-header" onclick="togglePicklist('${picklist.picklist_number}')">
            <div>
              <h3>${picklist.picklist_number}</h3>
              <p style="color: #6c757d; margin-top: 5px;">Order: ${picklist.order_info.order_name} | ${new Date(picklist.created_at).toLocaleDateString()}</p>
            </div>
            <div>
              <span class="status ${statusClass}">${picklist.status || 'pending'}</span>
              <span style="margin-left: 10px;">📦 ${picklist.total_items} items</span>
            </div>
          </div>
          <div class="picklist-body" id="body-${picklist.picklist_number}">
            <div class="info-grid">
              <div class="info-section">
                <h4>👤 Customer Information</h4>
                ${picklist.customer ? `
                  <p><strong>Name:</strong> ${picklist.customer.name}</p>
                  <p><strong>Email:</strong> ${picklist.customer.email || 'N/A'}</p>
                  <p><strong>Phone:</strong> ${picklist.customer.phone || 'N/A'}</p>
                ` : '<p>No customer information</p>'}
              </div>
              <div class="info-section">
                <h4>📮 Shipping Address</h4>
                ${picklist.shipping_address ? `
                  <p>${picklist.shipping_address.name || ''}</p>
                  <p>${picklist.shipping_address.address1 || ''}</p>
                  ${picklist.shipping_address.address2 ? `<p>${picklist.shipping_address.address2}</p>` : ''}
                  <p>${picklist.shipping_address.city || ''}, ${picklist.shipping_address.province || ''} ${picklist.shipping_address.zip || ''}</p>
                  <p>${picklist.shipping_address.country || ''}</p>
                ` : '<p>No shipping address</p>'}
              </div>
              <div class="info-section">
                <h4>📋 Order Details</h4>
                <p><strong>Order Status:</strong> ${picklist.order_info.financial_status || 'N/A'}</p>
                <p><strong>Fulfillment:</strong> ${picklist.order_info.fulfillment_status || 'Not fulfilled'}</p>
                <p><strong>Total:</strong> ${picklist.currency} ${picklist.total_price}</p>
                ${picklist.order_info.tags ? `<p><strong>Tags:</strong> ${picklist.order_info.tags}</p>` : ''}
              </div>
            </div>
            
            <h4>🛍️ Items to Pick</h4>
            <table class="items-table">
              <thead>
                <tr><th>SKU</th><th>Product</th><th>Variant</th><th>Quantity</th><th>Picked</th><th>Location</th></tr>
              </thead>
              <tbody>
      `;
      
      for (const item of picklist.items) {
        html += `
          <tr>
            <td>${item.sku}</td>
            <td>${item.title}</td>
            <td>${item.variant_title || '-'}</td>
            <td>${item.quantity}</td>
            <td><input type="number" class="quantity-input" data-picklist="${picklist.picklist_number}" data-sku="${item.sku}" value="0" min="0" max="${item.quantity}"></td>
            <td>${item.location || 'Main'}</td>
          </tr>
        `;
      }
      
      html += `
              </tbody>
            </table>
            
            <div>
              <label><strong>📝 Picklist Notes:</strong></label>
              <textarea class="notes-area" id="notes-${picklist.picklist_number}" rows="3" placeholder="Add any notes about this picklist...">${picklist.notes || ''}</textarea>
            </div>
            
            <div class="action-buttons">
              <button class="btn-print" onclick="printPicklist('${picklist.picklist_number}')">🖨️ Print</button>
              <button class="btn-success" onclick="updatePickedQuantities('${picklist.picklist_number}')">✓ Update Picked</button>
              <select id="status-${picklist.picklist_number}" class="status-select" style="padding: 10px;">
                <option value="pending" ${picklist.status === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="picking" ${picklist.status === 'picking' ? 'selected' : ''}>In Progress</option>
                <option value="packed" ${picklist.status === 'packed' ? 'selected' : ''}>Packed</option>
                <option value="shipped" ${picklist.status === 'shipped' ? 'selected' : ''}>Shipped</option>
              </select>
              <button class="btn-primary" onclick="updateStatus('${picklist.picklist_number}')">Update Status</button>
              <button class="btn-danger" onclick="deletePicklist('${picklist.picklist_number}')">🗑️ Delete</button>
            </div>
          </div>
        </div>
      `;
    }
    
    html += `
          </div>
        </div>
        
        <script>
          function togglePicklist(id) {
            const body = document.getElementById('body-' + id);
            body.classList.toggle('open');
          }
          
          function printPicklist(id) {
            const element = document.getElementById('body-' + id);
            const originalDisplay = element.style.display;
            element.style.display = 'block';
            window.print();
            element.style.display = originalDisplay;
          }
          
          function printSelected() {
            window.print();
          }
          
          async function updatePickedQuantities(picklistId) {
            const inputs = document.querySelectorAll(\\`input[data-picklist="\${picklistId}"]\\`);
            const pickedItems = {};
            inputs.forEach(input => {
              const sku = input.dataset.sku;
              const quantity = parseInt(input.value) || 0;
              if (quantity > 0) {
                pickedItems[sku] = quantity;
              }
            });
            
            const response = await fetch('/api/update-picked', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ picklistId, pickedItems })
            });
            
            if (response.ok) {
              alert('Picked quantities updated successfully!');
            } else {
              alert('Error updating picked quantities');
            }
          }
          
          async function updateStatus(picklistId) {
            const select = document.getElementById('status-' + picklistId);
            const status = select.value;
            const notes = document.getElementById('notes-' + picklistId).value;
            
            const response = await fetch('/api/update-status', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ picklistId, status, notes })
            });
            
            if (response.ok) {
              location.reload();
            } else {
              alert('Error updating status');
            }
          }
          
          async function deletePicklist(picklistId) {
            if (confirm('Are you sure you want to delete this picklist?')) {
              const response = await fetch('/api/delete-picklist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ picklistId })
              });
              
              if (response.ok) {
                location.reload();
              } else {
                alert('Error deleting picklist');
              }
            }
          }
          
          function exportToCSV() {
            const rows = [];
            const cards = document.querySelectorAll('.picklist-card');
            cards.forEach(card => {
              const picklistId = card.querySelector('.picklist-header h3').innerText;
              const orderName = card.querySelector('.picklist-header p').innerText.split('|')[0].trim();
              const status = card.querySelector('.status').innerText;
              const items = card.querySelectorAll('.items-table tbody tr');
              items.forEach(item => {
                const sku = item.cells[0].innerText;
                const product = item.cells[1].innerText;
                const quantity = item.cells[3].innerText;
                rows.push([picklistId, orderName, sku, product, quantity, status]);
              });
            });
            
            const csvContent = 'Picklist #,Order #,SKU,Product,Quantity,Status\\n' + 
              rows.map(row => row.join(',')).join('\\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'picklists_export.csv';
            a.click();
            URL.revokeObjectURL(url);
          }
          
          // Filter functionality
          document.getElementById('searchInput').addEventListener('input', filterPicklists);
          document.getElementById('statusFilter').addEventListener('change', filterPicklists);
          
          function filterPicklists() {
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();
            const statusFilter = document.getElementById('statusFilter').value;
            const cards = document.querySelectorAll('.picklist-card');
            
            cards.forEach(card => {
              const text = card.innerText.toLowerCase();
              const status = card.dataset.status;
              const matchesSearch = text.includes(searchTerm);
              const matchesStatus = !statusFilter || status === statusFilter;
              
              if (matchesSearch && matchesStatus) {
                card.style.display = '';
              } else {
                card.style.display = 'none';
              }
            });
          }
          
          // Open first picklist by default
          if (document.querySelector('.picklist-card')) {
            const firstId = document.querySelector('.picklist-card .picklist-header h3').innerText;
            togglePicklist(firstId);
          }
        </script>
      </body>
      </html>
    `;
    
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading picklists: " + err.message);
  }
});

// 4. API endpoint to update picked quantities
app.post("/api/update-picked", async (req, res) => {
  const { picklistId, pickedItems } = req.body;
  
  try {
    const result = await pool.query(
      "SELECT * FROM picklists WHERE picklist_data->>'picklist_number' = $1",
      [picklistId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Picklist not found" });
    }
    
    const picklist = result.rows[0].picklist_data;
    
    // Update items with picked quantities
    picklist.items = picklist.items.map(item => ({
      ...item,
      picked_quantity: pickedItems[item.sku] || 0
    }));
    
    picklist.last_updated = new Date().toISOString();
    
    await pool.query(
      "UPDATE picklists SET picklist_data = $1, updated_at = CURRENT_TIMESTAMP WHERE picklist_data->>'picklist_number' = $2",
      [JSON.stringify(picklist), picklistId]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 5. API endpoint to update status
app.post("/api/update-status", async (req, res) => {
  const { picklistId, status, notes } = req.body;
  
  try {
    const result = await pool.query(
      "SELECT * FROM picklists WHERE picklist_data->>'picklist_number' = $1",
      [picklistId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Picklist not found" });
    }
    
    const picklist = result.rows[0].picklist_data;
    picklist.status = status;
    picklist.notes = notes;
    picklist.last_updated = new Date().toISOString();
    
    await pool.query(
      "UPDATE picklists SET picklist_data = $1, updated_at = CURRENT_TIMESTAMP WHERE picklist_data->>'picklist_number' = $2",
      [JSON.stringify(picklist), picklistId]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 6. API endpoint to delete picklist
app.post("/api/delete-picklist", async (req, res) => {
  const { picklistId } = req.body;
  
  try {
    await pool.query(
      "DELETE FROM picklists WHERE picklist_data->>'picklist_number' = $1",
      [picklistId]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 7. API endpoint to get single picklist (for AJAX)
app.get("/api/picklist/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM picklists WHERE picklist_data->>'picklist_number' = $1",
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Picklist not found" });
    }
    
    res.json(result.rows[0].picklist_data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Home page
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Picklist App</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container {
          background: white;
          border-radius: 20px;
          padding: 50px;
          max-width: 600px;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        h1 {
          color: #008060;
          font-size: 48px;
          margin-bottom: 20px;
        }
        p {
          color: #666;
          line-height: 1.6;
          margin-bottom: 30px;
        }
        .button {
          display: inline-block;
          background: #008060;
          color: white;
          padding: 15px 30px;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          transition: background 0.3s;
        }
        .button:hover {
          background: #004c3f;
        }
        .steps {
          text-align: left;
          background: #f8f9fa;
          padding: 20px;
          border-radius: 10px;
          margin-top: 30px;
        }
        .steps h3 {
          color: #333;
          margin-bottom: 10px;
        }
        .steps ol {
          margin-left: 20px;
          color: #666;
        }
        .steps li {
          margin: 10px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📦 Picklist App</h1>
        <p>Streamline your order fulfillment process with organized picklists</p>
        <a href="/view-picklists" class="button">View All Picklists →</a>
        <div class="steps">
          <h3>How to use:</h3>
          <ol>
            <li>Go to Shopify Admin → Orders</li>
            <li>Select one or more orders</li>
            <li>Click the <strong>...</strong> (more actions) menu</li>
            <li>Select <strong>Create Picklist</strong></li>
            <li>View and manage your picklists below</li>
          </ol>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server started successfully on port ${PORT}`);
  console.log(`📋 Open: http://localhost:${PORT}`);
});
