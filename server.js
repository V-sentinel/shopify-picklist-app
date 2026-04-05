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

// Validate required environment variables
const requiredEnvVars = ['SHOPIFY_STORE', 'SHOPIFY_ACCESS_TOKEN', 'DATABASE_URL'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('Please set them in your .env file or hosting platform settings');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1); // Exit in production if misconfigured
  }
}

// ================= DATABASE WITH CONNECTION POOL IMPROVEMENTS =================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000 // Return an error after 2 seconds if connection could not be established
});

// Handle database connection errors
pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
});

// ================= INIT DB =================
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS picklists (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(255),
        order_number INTEGER,
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Add index for faster queries
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_picklists_created_at 
      ON picklists(created_at DESC);
    `);
    
    console.log("✅ Picklist table ready");
  } catch (err) {
    console.error("❌ Database initialization failed:", err.message);
    throw err;
  }
}

// Test database connection on startup
async function testDatabaseConnection() {
  try {
    await pool.query('SELECT NOW()');
    console.log("✅ Database connected successfully");
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
    process.exit(1);
  }
}

// ================= HEALTH CHECK ENDPOINT (for server monitoring) =================
app.get("/health", async (req, res) => {
  try {
    // Check database
    await pool.query('SELECT 1');
    
    // Check Shopify API (lightweight check)
    const shopifyCheck = await fetch(
      `https://${SHOP}/admin/api/2024-01/shop.json`,
      {
        headers: {
          "X-Shopify-Access-Token": TOKEN,
          "Content-Type": "application/json"
        }
      }
    );
    
    res.status(200).json({
      status: 'healthy',
      database: 'connected',
      shopify: shopifyCheck.ok ? 'connected' : 'error',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
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
        h1 { color: #333; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📦 Picklist Management App</h1>
        <div class="card">
          <a href="/orders" class="btn">📋 View Open Orders</a>
          <a href="/picklists" class="btn">📄 View Picklists</a>
          <a href="/health" class="btn">💚 Health Check</a>
        </div>
        <p>Server is running on port ${PORT}</p>
      </div>
    </body>
    </html>
  `);
});

// ================= FETCH ORDERS WITH PAGINATION =================
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
            <a href="/create-picklist/${order.id}" style="display:inline-block; background:#28a745; color:white; padding:5px 10px; margin-top:10px; text-decoration:none; border-radius:5px;">✅ Create Picklist</a>
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

// ================= CREATE PICKLIST =================
app.get("/create-picklist/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;

    // Fetch order from Shopify
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

    // Check if picklist already exists for this order
    const existing = await pool.query(
      "SELECT id FROM picklists WHERE order_id = $1",
      [orderId]
    );

    if (existing.rows.length > 0) {
      return res.send(`
        <h2>⚠️ Picklist Already Exists</h2>
        <p>A picklist for Order #${order.order_number} already exists.</p>
        <a href="/picklists">View Existing Picklists</a><br>
        <a href="/orders">← Back to Orders</a>
      `);
    }

    // Save picklist in DB with additional metadata
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
      <a href="/picklists" style="display:inline-block; background:#007bff; color:white; padding:10px; margin:5px; text-decoration:none; border-radius:5px;">📄 View All Picklists</a>
      <a href="/orders" style="display:inline-block; background:#28a745; color:white; padding:10px; margin:5px; text-decoration:none; border-radius:5px;">📋 Back to Orders</a>
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
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, closing database pool...');
  await pool.end();
  process.exit(0);
});

// ================= START SERVER =================
async function startServer() {
  try {
    await testDatabaseConnection();
    await initDB();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Picklist app running on port ${PORT}`);
      console.log(`📍 Local URL: http://localhost:${PORT}`);
      console.log(`🌍 Server is ready to accept connections`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
