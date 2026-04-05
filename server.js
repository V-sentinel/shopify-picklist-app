// Load environment variables - only in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require("express");
const { Pool } = require("pg");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ================= CONFIG WITH VALIDATION =================
const SHOP = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

// VALIDATE required environment variables at startup
const missingEnvVars = [];
if (!SHOP) missingEnvVars.push('SHOPIFY_STORE');
if (!TOKEN) missingEnvVars.push('SHOPIFY_ACCESS_TOKEN');

if (missingEnvVars.length > 0) {
  console.error('\n❌ MISSING REQUIRED ENVIRONMENT VARIABLES:');
  missingEnvVars.forEach(v => console.error(`   - ${v}`));
  console.error('\n📝 Create a .env file with:');
  console.error('   SHOPIFY_STORE=your-store.myshopify.com');
  console.error('   SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxx');
  console.error('   DATABASE_URL=postgresql://user:pass@localhost:5432/dbname\n');
  
  // Don't crash, but show error in UI
}

console.log('\n📋 Configuration:');
console.log(`   Shopify Store: ${SHOP || '❌ NOT SET'}`);
console.log(`   Shopify Token: ${TOKEN ? '✅ Set (hidden)' : '❌ NOT SET'}`);
console.log(`   Database URL: ${DATABASE_URL ? '✅ Set' : '❌ NOT SET'}`);
console.log(`   Port: ${PORT}\n`);

// Track database status
let dbConnected = false;
let dbRetryCount = 0;
const MAX_DB_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

// ================= DATABASE WITH ERROR HANDLING =================
let pool = null;

function createPool() {
  if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL environment variable is not set");
    return null;
  }

  try {
    const newPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    newPool.on('error', (err) => {
      console.error("❌ Database pool error:", err.message);
      dbConnected = false;
    });

    return newPool;
  } catch (err) {
    console.error("❌ Failed to create database pool:", err.message);
    return null;
  }
}

async function connectWithRetry() {
  if (!DATABASE_URL) {
    console.error("❌ Cannot connect: DATABASE_URL is missing");
    return false;
  }

  pool = createPool();
  if (!pool) return false;

  try {
    await pool.query('SELECT NOW()');
    dbConnected = true;
    dbRetryCount = 0;
    console.log("✅ Database connected successfully");
    await initDB();
    return true;
  } catch (err) {
    console.error(`❌ Database connection failed:`, err.message);
    dbConnected = false;
    return false;
  }
}

async function initDB() {
  if (!dbConnected || !pool) {
    return false;
  }
  
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS picklists (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(255),
        order_number INTEGER,
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_picklists_created_at 
      ON picklists(created_at DESC)
    `);
    
    console.log("✅ Picklist table ready");
    return true;
  } catch (err) {
    console.error("❌ Table initialization failed:", err.message);
    dbConnected = false;
    return false;
  }
}

// ================= HEALTH CHECK =================
app.get("/health", (req, res) => {
  const configStatus = {
    shopify_store: SHOP ? 'configured' : 'missing',
    shopify_token: TOKEN ? 'configured' : 'missing',
    database_url: DATABASE_URL ? 'configured' : 'missing'
  };
  
  const allConfigured = configStatus.shopify_store === 'configured' && 
                        configStatus.shopify_token === 'configured';
  
  res.status(allConfigured ? 200 : 503).json({
    status: allConfigured ? 'ready' : 'misconfigured',
    config: configStatus,
    database: dbConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    message: !allConfigured ? 'Missing Shopify configuration. Check .env file.' : undefined
  });
});

// ================= HOME =================
app.get("/", (req, res) => {
  const isConfigured = SHOP && TOKEN;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Picklist App</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        .container { max-width: 800px; margin: 0 auto; }
        .card { background: #f4f4f4; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .btn { display: inline-block; background: #007bff; color: white; padding: 10px 15px; 
               text-decoration: none; border-radius: 5px; margin: 5px; }
        .btn.disabled { background: #ccc; cursor: not-allowed; }
        .error { background: #f8d7da; border-left: 4px solid #dc3545; padding: 15px; margin: 20px 0; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
        h1 { color: #333; }
        code { background: #eee; padding: 2px 5px; border-radius: 3px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📦 Picklist Management App</h1>
        
        ${!isConfigured ? `
          <div class="error">
            <strong>❌ Configuration Error</strong><br><br>
            Missing Shopify configuration. Please create a <code>.env</code> file with:<br><br>
            <code>SHOPIFY_STORE=your-store.myshopify.com</code><br>
            <code>SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxx</code><br><br>
            <strong>Current status:</strong><br>
            • SHOPIFY_STORE: ${SHOP ? '✅ Set' : '❌ Missing'}<br>
            • SHOPIFY_ACCESS_TOKEN: ${TOKEN ? '✅ Set' : '❌ Missing'}<br>
          </div>
        ` : ''}
        
        ${!dbConnected && DATABASE_URL ? `
          <div class="warning">
            ⚠️ Database disconnected - picklist saving unavailable
          </div>
        ` : ''}
        
        <div class="card">
          ${isConfigured ? 
            '<a href="/orders" class="btn">📋 View Open Orders</a>' : 
            '<span class="btn disabled">📋 View Open Orders (Configure Shopify first)</span>'
          }
          <a href="/picklists" class="btn">📄 View Picklists</a>
          <a href="/health" class="btn">💚 Health Check</a>
        </div>
        <p>Server running on port ${PORT}</p>
      </div>
    </body>
    </html>
  `);
});

// ================= FETCH ORDERS =================
app.get("/orders", async (req, res) => {
  // Check Shopify configuration
  if (!SHOP || !TOKEN) {
    return res.status(500).send(`
      <h1>❌ Configuration Error</h1>
      <p>Shopify credentials are not configured.</p>
      <p>Please create a <code>.env</code> file with:</p>
      <pre>
SHOPIFY_STORE=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxx
      </pre>
      <a href="/">← Back to Home</a>
    `);
  }
  
  try {
    const limit = req.query.limit || 20;
    const shopifyUrl = `https://${SHOP}/admin/api/2024-01/orders.json?status=open&limit=${limit}`;
    
    console.log(`📡 Fetching orders from: ${SHOP}`);
    
    const response = await fetch(shopifyUrl, {
      headers: {
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Shopify API error ${response.status}:`, errorText);
      
      if (response.status === 401) {
        throw new Error("Invalid Shopify access token. Please check your SHOPIFY_ACCESS_TOKEN");
      }
      if (response.status === 404) {
        throw new Error(`Store '${SHOP}' not found. Please check your SHOPIFY_STORE`);
      }
      throw new Error(`Shopify API error: ${response.status}`);
    }

    const data = await response.json();

    let html = `
      <h1>📋 Open Orders from ${SHOP}</h1>
      <a href="/">← Back to Home</a>
      <br><br>
      <p>Showing ${data.orders?.length || 0} open orders</p>
    `;

    if (!data.orders || data.orders.length === 0) {
      html += "<p>No open orders found.</p>";
    } else {
      data.orders.forEach(order => {
        html += `
          <div style="border:1px solid #ddd; border-radius:8px; padding:15px; margin:10px 0; background:#f9f9f9;">
            <b>Order #${order.order_number}</b><br>
            Customer: ${order.customer?.first_name || ''} ${order.customer?.last_name || ''}<br>
            Items: ${order.line_items.length}<br>
            Total: $${order.total_price}<br>
            ${dbConnected ? 
              `<a href="/create-picklist/${order.id}" style="display:inline-block; background:#28a745; color:white; padding:5px 10px; margin-top:10px; text-decoration:none; border-radius:5px;">✅ Create Picklist</a>` :
              `<span style="color:#999;">⚠️ Database unavailable - cannot create picklist</span>`
            }
          </div>
        `;
      });
    }

    html += `<br><a href="/">← Back to Home</a>`;
    res.send(html);

  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).send(`
      <h1>❌ Error</h1>
      <p>Failed to fetch orders: ${err.message}</p>
      <hr>
      <h3>Troubleshooting:</h3>
      <ul>
        <li>Check that your SHOPIFY_STORE is correct (format: your-store.myshopify.com)</li>
        <li>Verify your SHOPIFY_ACCESS_TOKEN is valid</li>
        <li>Make sure the API token has read_orders scope</li>
      </ul>
      <a href="/">← Back to Home</a>
    `);
  }
});

// ================= CREATE PICKLIST =================
app.get("/create-picklist/:orderId", async (req, res) => {
  if (!dbConnected || !pool) {
    return res.status(503).send(`
      <h1>⚠️ Database Unavailable</h1>
      <p>Cannot create picklist because the database is not connected.</p>
      <a href="/orders">← Back to Orders</a>
    `);
  }
  
  try {
    const orderId = req.params.orderId;

    const response = await fetch(
      `https://${SHOP}/admin/api/2024-01/orders/${orderId}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }

    const data = await response.json();
    const order = data.order;

    await pool.query(
      `INSERT INTO picklists (order_id, order_number, data) 
       VALUES ($1, $2, $3)`,
      [orderId, order.order_number, order]
    );

    res.send(`
      <h2>✅ Picklist Created Successfully!</h2>
      <p>Order #${order.order_number} has been saved.</p>
      <div style="background:#f0f0f0; padding:15px; border-radius:8px; margin:20px 0;">
        <h3>Items to pick:</h3>
        <ul>
          ${order.line_items.map(item => `<li>${item.title} - Quantity: ${item.quantity}</li>`).join('')}
        </ul>
      </div>
      <a href="/picklists">📄 View All Picklists</a><br>
      <a href="/orders">📋 Back to Orders</a>
    `);

  } catch (err) {
    console.error('Error creating picklist:', err);
    res.status(500).send(`
      <h1>❌ Error Creating Picklist</h1>
      <p>${err.message}</p>
      <a href="/orders">← Back to Orders</a>
    `);
  }
});

// ================= VIEW PICKLISTS =================
app.get("/picklists", async (req, res) => {
  if (!dbConnected || !pool) {
    return res.status(503).send(`
      <h1>⚠️ Database Unavailable</h1>
      <p>Cannot retrieve picklists because the database is not connected.</p>
      <a href="/">← Back to Home</a>
    `);
  }
  
  try {
    const result = await pool.query(
      "SELECT * FROM picklists ORDER BY id DESC"
    );

    let html = `
      <h1>📄 Saved Picklists</h1>
      <a href="/">← Back to Home</a>
      <br><br>
      <p>Total picklists: ${result.rows.length}</p>
    `;

    if (result.rows.length === 0) {
      html += "<p>No picklists created yet. <a href='/orders'>Create one from orders</a>.</p>";
    } else {
      result.rows.forEach(row => {
        const order = row.data;
        const createdDate = new Date(row.created_at).toLocaleString();

        html += `
          <div style="border:1px solid #ddd; border-radius:8px; margin:15px 0; padding:15px; background:#fafafa;">
            <b>📦 Order #${order.order_number}</b>
            <span style="color:#666; font-size:12px;"> (Created: ${createdDate})</span><br>
            <div style="margin-top:10px; padding-left:20px;">
              ${order.line_items.map(item => `
                <div style="margin:5px 0;">
                  • ${item.title} - <b>Qty: ${item.quantity}</b>
                </div>
              `).join("")}
            </div>
          </div>
        `;
      });
    }

    html += `<br><a href="/">← Back to Home</a>`;
    res.send(html);

  } catch (err) {
    console.error('Error fetching picklists:', err);
    res.status(500).send(`
      <h1>❌ Database Error</h1>
      <p>Failed to fetch picklists: ${err.message}</p>
      <a href="/">← Back to Home</a>
    `);
  }
});

// ================= START SERVER =================
async function startServer() {
  console.log("🚀 Starting Picklist App...");
  
  // Try to connect to database (doesn't block server)
  connectWithRetry().then(connected => {
    if (connected) {
      console.log("✅ App fully operational with database");
    } else if (DATABASE_URL) {
      console.log("⚠️ App running without database - picklist saving unavailable");
    }
  });
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🌍 Server running on http://localhost:${PORT}`);
    console.log(`📋 Health check: http://localhost:${PORT}/health\n`);
  });
}

startServer();
