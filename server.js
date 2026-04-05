import express from 'express';
import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import { PostgreSQLSessionStorage } from '@shopify/shopify-app-session-storage-postgresql';
import { restResources } from '@shopify/shopify-api/rest/admin/2024-01';

const app = express();

// Enable JSON parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES?.split(',') || ['read_orders', 'write_orders'],
  hostName: process.env.HOST?.replace(/https:\/\//, '') || 'localhost:3000',
  hostScheme: process.env.NODE_ENV === 'production' ? 'https' : 'http',
  apiVersion: ApiVersion.January24,
  isEmbeddedApp: true,
  restResources,
});

// Session storage
const sessionStorage = new PostgreSQLSessionStorage(process.env.DATABASE_URL);

// ================= HEALTH CHECK =================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ================= OAuth Routes =================
app.get('/auth', async (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }
  
  const authRoute = await shopify.auth.begin({
    shop,
    callbackPath: '/auth/callback',
    isOnline: false,
    rawRequest: req,
    rawResponse: res,
  });
  
  res.redirect(authRoute);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const callbackResponse = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });
    
    const { session } = callbackResponse;
    
    // Store session in database
    await sessionStorage.storeSession(session);
    
    // Redirect to app
    res.redirect(`/?shop=${session.shop}`);
  } catch (error) {
    console.error('Auth callback error:', error);
    res.status(500).send('Authentication failed');
  }
});

// ================= Middleware to check auth =================
async function authenticateShop(req, res, next) {
  const shop = req.query.shop || req.body.shop;
  
  if (!shop) {
    return res.status(401).json({ error: 'Shop parameter required' });
  }
  
  try {
    const session = await sessionStorage.loadSession(`${shop}_${process.env.SHOPIFY_API_KEY}`);
    
    if (!session || session.isExpired()) {
      return res.status(401).json({ 
        error: 'Not authenticated',
        authUrl: `/auth?shop=${shop}`
      });
    }
    
    req.shopifySession = session;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// ================= ROOT ROUTE =================
app.get('/', (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Picklist App</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
          .container { max-width: 500px; margin: 0 auto; padding: 40px; border-radius: 8px; background: #f4f6f8; }
          input { padding: 10px; width: 70%; margin-right: 10px; }
          button { padding: 10px 20px; background: #008060; color: white; border: none; border-radius: 4px; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📦 Picklist App</h1>
          <p>Enter your Shopify store URL to get started</p>
          <form onsubmit="installApp(event)">
            <input type="text" id="shop" placeholder="your-store.myshopify.com" />
            <button type="submit">Install App</button>
          </form>
        </div>
        <script>
          function installApp(e) {
            e.preventDefault();
            const shop = document.getElementById('shop').value.trim();
            if (shop) {
              window.location.href = \`/auth?shop=\${shop}\`;
            }
          }
        </script>
      </body>
      </html>
    `);
    return;
  }
  
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
          border: none;
          cursor: pointer;
        }
        .btn-secondary {
          background: #6b6b6b;
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
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📦 Picklist Management App</h1>
          <p>Store: <strong>${shop}</strong></p>
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
        const shop = '${shop}';
        
        async function loadOrders() {
          document.getElementById('app-content').innerHTML = '<p>Loading orders...</p>';
          try {
            const response = await fetch(\`/api/orders?shop=\${shop}\`);
            const data = await response.json();
            
            if (!response.ok) throw new Error(data.error || 'Failed to load orders');
            
            if (data.orders.length === 0) {
              document.getElementById('app-content').innerHTML = '<p>No open orders found.</p>';
              return;
            }
            
            let html = '<h2>📋 Open Orders</h2>';
            data.orders.forEach(order => {
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
            document.getElementById('app-content').innerHTML = html;
          } catch (error) {
            document.getElementById('app-content').innerHTML = '<div class="error">❌ Error: ' + error.message + '</div>';
          }
        }

        async function loadPicklists() {
          document.getElementById('app-content').innerHTML = '<p>Loading picklists...</p>';
          try {
            const response = await fetch(\`/api/picklists?shop=\${shop}\`);
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
                  <div style="margin-top:10px; padding-left:20px;">
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
              body: JSON.stringify({ orderId, shop })
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

// ================= API ROUTES =================

// Get open orders
app.get('/api/orders', authenticateShop, async (req, res) => {
  try {
    const { session } = req.shopifySession;
    const client = new shopify.clients.Rest({ session });
    
    const response = await client.get({
      path: 'orders',
      query: { status: 'open', limit: 50 }
    });
    
    res.json({ orders: response.body.orders || [] });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create picklist
app.post('/api/create-picklist', authenticateShop, async (req, res) => {
  try {
    const { session } = req.shopifySession;
    const { orderId } = req.body;
    
    const client = new shopify.clients.Rest({ session });
    
    const response = await client.get({
      path: `orders/${orderId}`
    });
    
    const order = response.body.order;
    
    // Store picklist in database
    const query = `
      INSERT INTO picklists (shop, order_id, order_number, order_data, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id
    `;
    
    const result = await sessionStorage.db.query(query, [
      session.shop, 
      orderId, 
      order.order_number, 
      JSON.stringify(order)
    ]);
    
    res.json({ 
      success: true, 
      message: `Picklist created for Order #${order.order_number}`,
      picklistId: result.rows[0].id
    });
  } catch (error) {
    console.error('Error creating picklist:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all picklists
app.get('/api/picklists', authenticateShop, async (req, res) => {
  try {
    const { session } = req.shopifySession;
    
    const result = await sessionStorage.db.query(
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
    await sessionStorage.db.query(`
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
    await sessionStorage.db.query(`
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
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`🔐 Install app: http://localhost:${PORT}/auth?shop=your-shop.myshopify.com`);
  
  // Initialize database after server starts
  setTimeout(initDatabase, 2000);
});
