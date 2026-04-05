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
      connectionTimeoutMillis: 5000 // Fail fast if can't connect
    });

    // Add error handler to the pool
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

// ================= RETRY CONNECTION WITH BACKOFF =================
async function connectWithRetry() {
  if (!DATABASE_URL) {
    console.error("❌ Cannot connect: DATABASE_URL is missing");
    console.error("   Please set DATABASE_URL environment variable");
    return false;
  }

  pool = createPool();
  if (!pool) return false;

  try {
    // Try to query the database
    await pool.query('SELECT NOW()');
    dbConnected = true;
    dbRetryCount = 0;
    console.log("✅ Database connected successfully");
    
    // Initialize tables
    await initDB();
    return true;
    
  } catch (err) {
    console.error(`❌ Database connection failed (attempt ${dbRetryCount + 1}/${MAX_DB_RETRIES}):`, err.message);
    
    if (err.message.includes('password authentication failed')) {
      console.error("   🔑 PASSWORD AUTHENTICATION FAILED - Please check your DATABASE_URL credentials");
      console.error("   Format should be: postgresql://username:password@host:port/database");
      dbConnected = false;
      return false;
    }
    
    if (err.message.includes('does not exist')) {
      console.error("   💾 DATABASE DOES NOT EXIST - Please create the database first");
      dbConnected = false;
      return false;
    }
    
    dbConnected = false;
    
    // Retry logic
    if (dbRetryCount < MAX_DB_RETRIES) {
      dbRetryCount++;
      const delay = RETRY_DELAY_MS * Math.pow(2, dbRetryCount - 1);
      console.log(`   Retrying in ${delay/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return connectWithRetry();
    } else {
      console.error("❌ Max retries reached. App will run in DEGRADED MODE (database features unavailable)");
      return false;
    }
  }
}

// ================= INIT DB (only if connected) =================
async function initDB() {
  if (!dbConnected || !pool) {
    console.log("⏳ Database not connected - skipping table initialization");
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

// ================= HEALTH CHECK ENDPOINT =================
app.get("/health", async (req, res) => {
  let dbStatus = 'unknown';
  
  if (pool && dbConnected) {
    try {
      await pool.query('SELECT 1');
      dbStatus = 'connected';
    } catch (err) {
      dbStatus = 'disconnected';
      dbConnected = false;
    }
  } else {
    dbStatus = 'disconnected';
  }
  
  res.status(dbStatus === 'connected' ? 200 : 503).json({
    status: dbStatus === 'connected' ? 'healthy' : 'degraded',
    database: dbStatus,
    database_url_configured: !!DATABASE_URL,
    timestamp: new Date().toISOString(),
    message: dbStatus !== 'connected' ? 'Database features unavailable. Check DATABASE_URL configuration.' : undefined
  });
});

// ================= HOME =================
app.get("/", async (req, res) => {
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
        .btn:hover { background: #0056b3; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
        h1 { color: #333; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📦 Picklist Management App</h1>
        ${!dbConnected ? `
          <div class="warning">
            ⚠️ <strong>Database Disconnected</strong><br>
            The app is running in degraded mode. Please check your DATABASE_URL environment variable.
            <a href="/health">Check health status →</a>
          </div>
        ` : ''}
        <div class="card">
          <a href="/orders" class="btn">📋 View Open Orders</a>
          <a href="/picklists" class="btn">📄 View Picklists</a>
          <a href="/health" class="btn">💚 Health Check</a>
        </div>
        <p>Server is running on port ${PORT}</p>
        <p>Database: ${dbConnected ? '✅ Connected' : '❌ Disconnected'}</p>
      </div>
    </body>
    </html>
  `);
});

// ================= FETCH ORDERS =================
app.get("/orders", async (req, res) => {
  try {
    const limit = req.query.limit || 20;
    const response = await fetch(
      `https://${SHOP}/admin/api/2024-01/orders.json?status=open&limit=${limit}`,
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

    let html = `
      <h1>📋 Open Orders</h1>
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
      <a href="/">← Back to Home</a>
    `);
  }
});

// ================= CREATE PICKLIST (with DB check) =================
app.get("/create-picklist/:orderId", async (req, res) => {
  // Check database connection first
  if (!dbConnected || !pool) {
    return res.status(503).send(`
      <h1>⚠️ Database Unavailable</h1>
      <p>Cannot create picklist because the database is not connected.</p>
      <p>Please check your DATABASE_URL environment variable and ensure PostgreSQL is running.</p>
      <a href="/">← Back to Home</a>
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

    const result = await pool.query(
      `INSERT INTO picklists (order_id, order_number, data) 
       VALUES ($1, $2, $3) 
       RETURNING *`,
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

// ================= VIEW PICKLISTS (with DB check) =================
app.get("/picklists", async (req, res) => {
  if (!dbConnected || !pool) {
    return res.status(503).send(`
      <h1>⚠️ Database Unavailable</h1>
      <p>Cannot retrieve picklists because the database is not connected.</p>
      <p>Please check your DATABASE_URL environment variable and ensure PostgreSQL is running.</p>
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

// ================= GRACEFUL SHUTDOWN =================
process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, closing database pool...');
  if (pool) await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, closing database pool...');
  if (pool) await pool.end();
  process.exit(0);
});

// ================= START SERVER =================
async function startServer() {
  console.log("🚀 Starting Picklist App...");
  
  // Try to connect to database (non-blocking, won't crash app)
  connectWithRetry().then(connected => {
    if (connected) {
      console.log("✅ App fully operational with database");
    } else {
      console.log("⚠️ App running in degraded mode without database");
      console.log("   Set DATABASE_URL to enable picklist storage");
    }
  });
  
  // Start HTTP server regardless of database status
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌍 Server running on port ${PORT}`);
    console.log(`📍 Local URL: http://localhost:${PORT}`);
    console.log(`📋 Health check: http://localhost:${PORT}/health`);
  });
}

startServer();
