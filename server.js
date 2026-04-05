import express from 'express';
import { shopifyApp } from '@shopify/shopify-app-express';
import { PostgreSQLSessionStorage } from '@shopify/shopify-app-session-storage-postgresql';
import { restResources } from '@shopify/shopify-api/rest/admin/2024-01';

const app = express();

// Enable JSON parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Shopify App
const shopify = shopifyApp({
  api: {
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    scopes: process.env.SCOPES?.split(',') || ['read_orders', 'write_orders'],
    hostName: process.env.HOST?.replace(/https:\/\//, '') || 'localhost:3000',
    hostScheme: process.env.NODE_ENV === 'production' ? 'https' : 'http',
    restResources,
    isEmbeddedApp: true,
  },
  auth: {
    path: '/auth',
    callbackPath: '/auth/callback',
  },
  sessionStorage: new PostgreSQLSessionStorage(process.env.DATABASE_URL),
  webhooks: {
    path: '/webhooks',
  },
});

// Mount Shopify middleware
app.use(shopify.authMiddleware());

// ================= HEALTH CHECK =================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ================= ROOT ROUTE (App Entry Point) =================
app.get('/', async (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Picklist App</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          margin: 0;
          padding: 0;
          background: #f1f2f6;
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 40px 20px;
        }
        .header {
          background: white;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 { margin: 0 0 10px 0; color: #111; }
        .content {
          background: white;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .btn {
          display: inline-block;
          background: #008060;
          color: white;
          padding: 10px 20px;
          text-decoration: none;
          border-radius: 4px;
          margin: 5px;
          font-weight: 500;
        }
        .btn-secondary {
          background: #6b6b6b;
        }
        .btn:hover {
          opacity: 0.9;
        }
        .orders-list {
          margin-top: 20px;
        }
        .order-card {
          border: 1px solid #e1e1e1;
          border-radius: 8px;
          padding: 15px;
          margin: 10px 0;
          background: #fafafa;
        }
        .order-number {
          font-size: 18px;
          font-weight: bold;
          color: #008060;
        }
        .picklist-items {
          background: #f9f9f9;
          padding: 15px;
          border-radius: 8px;
          margin: 15px 0;
        }
        .success {
          background: #d4edda;
          color: #155724;
          padding: 15px;
          border-radius: 8px;
          margin: 15px 0;
        }
        .error {
          background: #f8d7da;
          color: #721c24;
          padding: 15px;
          border-radius: 8px;
          margin: 15px 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th, td {
          text-align: left;
          padding: 12px;
          border-bottom: 1px solid #e1e1e1;
        }
        th {
          background: #f4f6f8;
          font-weight: 600;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📦 Picklist Management App</h1>
          <p>Manage and generate picklists for your Shopify orders</p>
        </div>
        <div class="content">
          <div style="margin-bottom: 20px;">
            <button onclick="loadOrders()" class="btn">📋 Load Orders</button>
            <button onclick="loadPicklists()" class="btn btn-secondary">📄 View Picklists</button>
          </div>
          <div id="app-content">
            <p>Click "Load Orders" to see your open orders and create picklists.</p>
          </div>
        </div>
      </div>

      <script>
        async function loadOrders() {
          document.getElementById('app-content').innerHTML = '<p>Loading orders...</p>';
          try {
            const response = await fetch('/api/orders');
            const orders = await response.json();
            
            if (!response.ok) throw new Error(orders.error || 'Failed to load orders');
            
            let html = '<h2>📋 Open Orders</h2>';
            if (orders.length === 0) {
              html += '<p>No open orders found.</p>';
            } else {
              orders.forEach(order => {
                html += \`
                  <div class="order-card">
                    <div class="order-number">Order #\${order.order_number}</div>
                    <div>Customer: \${order.customer?.first_name || ''} \${order.customer?.last_name || ''}</div>
                    <div>Items: \${order.line_items?.length || 0}</div>
                    <div>Total: $\${order.total_price}</div>
                    <button onclick="createPicklist('\${order.id}')" class="btn" style="margin-top:10px;">✅ Create Picklist</button>
                  </div>
                \`;
              });
            }
            document.getElementById('app-content').innerHTML = html;
          } catch (error) {
            document.getElementById('app-content').innerHTML = '<div class="error">❌ Error: ' + error.message + '</div>';
          }
        }

        async function loadPicklists() {
          document.getElementById('app-content').innerHTML = '<p>Loading picklists...</p>';
          try {
            const response = await fetch('/api/picklists');
            const picklists = await response.json();
            
            if (!response.ok) throw new Error(picklists.error || 'Failed to load picklists');
            
            if (picklists.length === 0) {
              document.getElementById('app-content').innerHTML = '<p>No picklists created yet. Load orders to create one.</p>';
              return;
            }
            
            let html = '<h2>📄 Saved Picklists</h2>';
            picklists.forEach(picklist => {
              const order = picklist.order_data;
              const createdDate = new Date(picklist.created_at).toLocaleString();
              
              html += \`
                <div class="order-card">
                  <div class="order-number">Order #\${order.order_number}</div>
                  <div style="color:#666; font-size:12px;">Created: \${createdDate}</div>
                  <div class="picklist-items">
                    <strong>Items to pick:</strong>
                    <ul>
                      \${order.line_items?.map(item => '<li>' + item.title + ' - Qty: ' + item.quantity + '</li>').join('') || '<li>No items</li>'}
                    </ul>
                  </div>
                </div>
              \`;
            });
            document.getElementById('app-content').innerHTML = html;
          } catch (error) {
            document.getElementById('app-content').innerHTML = '<div class="error">❌ Error: ' + error.message + '</div>';
          }
        }

        async function createPicklist(orderId) {
          try {
            const response = await fetch('/api/create-picklist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId })
            });
            const result = await response.json();
            
            if (response.ok) {
              document.getElementById('app-content').innerHTML = \`
                <div class="success">
                  ✅ \${result.message}
                  <div style="margin-top: 10px;">
                    <button onclick="loadOrders()" class="btn">Back to Orders</button>
                    <button onclick="loadPicklists()" class="btn btn-secondary">View Picklists</button>
                  </div>
                </div>
              \`;
            } else {
              throw new Error(result.error);
            }
          } catch (error) {
            alert('Error: ' + error.message);
          }
        }
      </script>
    </body>
    </html>
  `);
});

// ================= API ROUTES (Protected by Shopify Auth) =================

// Get open orders
app.get('/api/orders', shopify.authenticate.admin, async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const client = new shopify.api.clients.Rest({ session });
    
    const response = await client.get({
      path: 'orders',
      query: { status: 'open', limit: 50 }
    });
    
    res.json(response.body.orders || []);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create picklist
app.post('/api/create-picklist', shopify.authenticate.admin, async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const { orderId } = req.body;
    
    const client = new shopify.api.clients.Rest({ session });
    
    // Fetch the order details
    const response = await client.get({
      path: `orders/${orderId}`
    });
    
    const order = response.body.order;
    
    // Store picklist in database
    const dbResult = await shopify.sessionStorage.db.query(
      `INSERT INTO picklists (shop, order_id, order_number, order_data, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id`,
      [session.shop, orderId, order.order_number, JSON.stringify(order)]
    );
    
    res.json({ 
      success: true, 
      message: `Picklist created for Order #${order.order_number}`,
      picklistId: dbResult.rows[0].id
    });
  } catch (error) {
    console.error('Error creating picklist:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all picklists
app.get('/api/picklists', shopify.authenticate.admin, async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    
    const result = await shopify.sessionStorage.db.query(
      `SELECT * FROM picklists 
       WHERE shop = $1 
       ORDER BY created_at DESC`,
      [session.shop]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching picklists:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================= INITIALIZE DATABASE TABLES =================
async function initDatabase() {
  try {
    // Create picklists table if it doesn't exist
    await shopify.sessionStorage.db.query(`
      CREATE TABLE IF NOT EXISTS picklists (
        id SERIAL PRIMARY KEY,
        shop VARCHAR(255) NOT NULL,
        order_id VARCHAR(255) NOT NULL,
        order_number INTEGER NOT NULL,
        order_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create index for faster queries
    await shopify.sessionStorage.db.query(`
      CREATE INDEX IF NOT EXISTS idx_picklists_shop_created 
      ON picklists(shop, created_at DESC)
    `);
    
    console.log('✅ Database tables ready');
  } catch (error) {
    console.error('❌ Database initialization error:', error.message);
  }
}

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 OAuth path: /auth?shop=your-shop.myshopify.com`);
  
  // Initialize database after Shopify is ready
  setTimeout(initDatabase, 2000);
});
