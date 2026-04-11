import express from "express";
import fetch from "node-fetch";
import { Pool } from "pg";
import cors from "cors";
import attachBulkActionRoutes from "./index.js";

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const SHOP = (process.env.SHOP_NAME || "").trim();
const CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || "").trim();
const CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || "").trim();
const ADMIN_ACCESS_TOKEN = (process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN || "").trim();
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL;

console.log("🚀 Starting Picklist App (ESM Version)...");
console.log("=" .repeat(50));
console.log("📋 Configuration Check:");
console.log(`  SHOP_NAME: ${SHOP ? "✅ " + SHOP : "❌ MISSING"}`);
console.log(`  CLIENT_ID: ${CLIENT_ID ? "✅ Set" : "❌ MISSING"}`);
console.log(`  CLIENT_SECRET: ${CLIENT_SECRET ? "✅ Set" : "❌ MISSING"}`);
console.log(`  ADMIN_ACCESS_TOKEN: ${ADMIN_ACCESS_TOKEN ? "✅ Set" : "⚠️ Not set"}`);
if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("\n❌ CRITICAL ERROR: Missing required Shopify credentials in environment variables");
  console.error("   Please set: SHOP_NAME, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET");
  if (!DATABASE_URL) {
    console.error("\n💡 Tip: You need at least database OR Shopify credentials to run");
  }
  // Don't exit immediately - let it try to run with what it has
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: ["https://*.myshopify.com", "https://*.shopifyapps.com"],
  credentials: true,
}));

// ================= DATABASE =================
let pool = null;

if (DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 8,
      connectionTimeoutMillis: 5000,
    });
    console.log("✅ Database pool created");
  } catch (err) {
    console.error("❌ Failed to create database pool:", err.message);
    pool = null;
  }
} else {
  console.warn("⚠️ No DATABASE_URL - Running without database (demo mode)");
}

async function initDB() {
  if (!pool) {
    console.warn("⚠️ Database not available - skipping DB initialization");
    return false;
  }
  
  try {
    // Test connection first
    await pool.query("SELECT NOW()");
    console.log("✅ Database connected successfully");
    
    // Create tables
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

    await pool.query(`
      ALTER TABLE picklists
        ADD COLUMN IF NOT EXISTS order_name TEXT,
        ADD COLUMN IF NOT EXISTS order_data JSONB,
        ADD COLUMN IF NOT EXISTS picklist_data JSONB,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);

    // Create index for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_picklists_order_name ON picklists(order_name);
      CREATE INDEX IF NOT EXISTS idx_picklists_created_at ON picklists(created_at DESC);
    `);
    
    console.log("✅ Database tables ready");
    return true;
  } catch (err) {
    console.error("❌ Database initialization error:", err.message);
    if (err.message.includes("does not exist")) {
      console.error("   💡 Database might not be provisioned yet. Create a PostgreSQL database in Render.");
    }
    return false;
  }
}

// Initialize DB but don't block startup
initDB().catch(err => console.error("DB init error:", err));

// ================= TOKEN MANAGEMENT =================
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (ADMIN_ACCESS_TOKEN) {
    console.log("✅ Using configured Shopify admin access token");
    return ADMIN_ACCESS_TOKEN;
  }

  if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing Shopify credentials. Please check environment variables: SHOP_NAME, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET");
  }

  throw new Error(
    "Shopify OAuth is not implemented in this app. Please set SHOPIFY_ADMIN_ACCESS_TOKEN or add a proper OAuth flow."
  );
}

// ================= HELPER FUNCTIONS =================

async function fetchOrderDetails(orderId) {
  if (!orderId) {
    throw new Error("Order ID is required");
  }
  
  const token = await getAccessToken();
  const url = `https://${SHOP}.myshopify.com/admin/api/2025-01/orders/${orderId}.json`;
  
  console.log(`📦 Fetching order ${orderId} from Shopify...`);
  
  const response = await fetch(url, { 
    headers: { 
      "X-Shopify-Access-Token": token,
      "User-Agent": "Picklist-App/1.0"
    } 
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Failed to fetch order ${orderId}: ${response.status}`, errorText);
    throw new Error(`Shopify API error: ${response.status} - ${errorText.substring(0, 200)}`);
  }
  
  const data = await response.json();
  
  if (!data.order) {
    throw new Error(`Order ${orderId} not found`);
  }
  
  console.log(`✅ Order ${data.order.name} fetched successfully`);
  return data.order;
}

function generatePicklistNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `PL-${year}${month}${day}-${hours}${minutes}${seconds}-${random}`;
}

function createPicklistData(order) {
  if (!order || !Array.isArray(order.line_items)) {
    console.warn('⚠️ createPicklistData received invalid order data:', order && order.id ? order.id : 'unknown');
    order = order || {};
  }

  const items = Array.isArray(order.line_items) ? order.line_items.map(item => ({
    product_id: item.product_id,
    variant_id: item.variant_id,
    sku: item.sku || 'N/A',
    title: item.title || 'Unknown product',
    variant_title: item.variant_title || 'Default',
    quantity: item.quantity || 0,
    price: item.price || '0.00',
    location: item.location_id || 'Main Warehouse',
    barcode: item.barcode || null,
    grams: item.grams || 0,
    requires_shipping: item.requires_shipping || false,
    fulfillment_service: item.fulfillment_service || 'manual',
    picked_quantity: 0 // Track how many have been picked
  })) : [];

  return {
    picklist_number: generatePicklistNumber(),
    created_at: new Date().toISOString(),
    order_info: {
      order_id: order.id,
      order_name: order.name,
      order_number: order.order_number,
      created_at: order.created_at,
      updated_at: order.updated_at,
      financial_status: order.financial_status || 'pending',
      fulfillment_status: order.fulfillment_status || 'unfulfilled',
      tags: order.tags || '',
      note: order.note || '',
      total_price: order.total_price,
      subtotal_price: order.subtotal_price,
      total_tax: order.total_tax,
      currency: order.currency
    },
    customer: order.customer ? {
      id: order.customer.id,
      email: order.customer.email,
      phone: order.customer.phone,
      first_name: order.customer.first_name,
      last_name: order.customer.last_name || '',
      name: `${order.customer.first_name} ${order.customer.last_name || ''}`.trim()
    } : null,
    shipping_address: order.shipping_address ? {
      name: order.shipping_address.name,
      address1: order.shipping_address.address1,
      address2: order.shipping_address.address2 || '',
      city: order.shipping_address.city,
      province: order.shipping_address.province,
      zip: order.shipping_address.zip,
      country: order.shipping_address.country,
      phone: order.shipping_address.phone
    } : null,
    items: items,
    total_items: items.reduce((sum, item) => sum + item.quantity, 0),
    total_price: order.total_price,
    currency: order.currency,
    status: 'pending', // pending, picking, packed, shipped
    notes: '',
    last_updated: new Date().toISOString()
  };
}

attachBulkActionRoutes({ app, getPool: () => pool, fetchOrderDetails, createPicklistData });

// ================= OAUTH ROUTES =================

// Generate install URL for testing
app.get("/install", (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send(`
      <h1>Missing Shop Parameter</h1>
      <p>Please provide a shop parameter: /install?shop=yourstore.myshopify.com</p>
      <p>Example: <a href="/install?shop=teststore.myshopify.com">/install?shop=teststore.myshopify.com</a></p>
    `);
  }

  const scopes = "read_orders,write_draft_orders,read_customers,write_fulfillments";
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  console.log(`🔗 Generated install URL for shop: ${shop}`);
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Install Picklist App</title>
      <style>
        body { font-family: sans-serif; padding: 40px; text-align: center; }
        .install-button {
          background: #008060;
          color: white;
          padding: 20px 40px;
          text-decoration: none;
          border-radius: 8px;
          font-size: 18px;
          display: inline-block;
          margin: 20px;
        }
        .install-button:hover { background: #004c3f; }
        .url { background: #f5f5f5; padding: 10px; border-radius: 4px; font-family: monospace; word-break: break-all; }
      </style>
    </head>
    <body>
      <h1>📦 Install Picklist App</h1>
      <p>Click below to install the app on your Shopify store:</p>
      <a href="${installUrl}" class="install-button">Install App →</a>
      <p><small>Or copy this URL:</small></p>
      <div class="url">${installUrl}</div>
      <p><a href="/">← Back to Home</a></p>
    </body>
    </html>
  `);
});

// Start OAuth flow
app.get("/auth", (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send("Missing shop parameter");
  }

  const scopes = "read_orders,write_draft_orders,read_customers,write_fulfillments";
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  console.log(`🔗 Redirecting to Shopify OAuth: ${installUrl}`);
  res.redirect(installUrl);
});

// Handle OAuth callback
app.get("/auth/callback", async (req, res) => {
  const { code, shop } = req.query;

  if (!code || !shop) {
    return res.status(400).send("Missing code or shop parameter");
  }

  try {
    console.log(`🔄 Exchanging code for access token for shop: ${shop}`);

    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ OAuth token exchange failed:", errorText);
      return res.status(500).send("Failed to exchange code for access token");
    }

    const data = await response.json();
    const accessToken = data.access_token;

    if (!accessToken) {
      console.error("❌ No access token in response:", data);
      return res.status(500).send("No access token received");
    }

    console.log(`✅ OAuth successful for shop: ${shop}`);

    // Store the access token (in production, you'd store this in a database)
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = accessToken;
    process.env.SHOP_NAME = shop.replace('.myshopify.com', '');

    // For embedded apps, redirect to the embedded app interface
    const embeddedUrl = `https://${shop}/admin/apps/${CLIENT_ID}`;
    console.log(`🔗 Redirecting to embedded app: ${embeddedUrl}`);
    res.redirect(embeddedUrl);

  } catch (error) {
    console.error("❌ OAuth callback error:", error);
    res.status(500).send("OAuth callback failed");
  }
});

// API endpoint for embedded app
app.get("/api/picklists", async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: "Database not available" });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM picklists ORDER BY created_at DESC"
    );

    const picklists = result.rows.map(row => row.picklist_data || {
      picklist_number: 'UNKNOWN',
      created_at: new Date().toISOString(),
      status: 'pending',
      order_info: { order_name: row.order_name || 'Unknown order' },
      items: []
    });

    // Calculate stats
    const stats = {
      total: picklists.length,
      pending: picklists.filter(p => p.status === 'pending').length,
      picking: picklists.filter(p => p.status === 'picking').length,
      packed: picklists.filter(p => p.status === 'packed').length,
      shipped: picklists.filter(p => p.status === 'shipped').length
    };

    res.json({ picklists, stats });
  } catch (err) {
    console.error("❌ API error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 1. Bulk Action → Creates picklist for selected orders
app.get("/bulk-action", async (req, res) => {
  const ids = req.query.ids ? req.query.ids.split(",") : [];
  
  console.log(`📋 Bulk action triggered with ${ids.length} order(s):`, ids);
  
  if (ids.length === 0) {
    console.warn("⚠️ No order IDs provided");
    return res.status(400).json({ error: "No order IDs provided" });
  }

  if (!pool) {
    console.error("❌ Cannot create picklist - database not available");
    return res.status(503).json({ error: "Database not available" });
  }

  try {
    const picklists = [];
    
    for (const id of ids) {
      try {
        const order = await fetchOrderDetails(id);
        
        if (order) {
          const picklistData = createPicklistData(order);
          
          await pool.query(
            `INSERT INTO picklists (order_name, order_data, picklist_data) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (order_name) 
             DO UPDATE SET 
               order_data = $2, 
               picklist_data = $3, 
               updated_at = CURRENT_TIMESTAMP`,
            [order.name, JSON.stringify(order), JSON.stringify(picklistData)]
          );
          
          picklists.push(picklistData);
          console.log(`✅ Picklist created for order ${order.name}: ${picklistData.picklist_number}`);
        }
      } catch (err) {
        console.error(`❌ Failed to create picklist for order ${id}:`, err.message);
        // Continue with other orders even if one fails
      }
    }
    
    if (picklists.length === 0) {
      throw new Error("No picklists were created successfully");
    }
    
    const idsParam = picklists.map(p => p.picklist_number).join(',');
    res.json({ 
      success: true, 
      message: `Successfully created ${picklists.length} picklist(s)!`,
      picklists: picklists.map(p => ({ id: p.picklist_number, order_name: p.order_info.order_name }))
    });
  } catch (err) {
    console.error("❌ Bulk action error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 4. API endpoint to update picked quantities
app.post("/api/update-picked", async (req, res) => {
  const { picklistId, pickedItems } = req.body;
  
  if (!picklistId) {
    return res.status(400).json({ error: "Picklist ID is required" });
  }
  
  if (!pool) {
    return res.status(503).json({ error: "Database not available" });
  }
  
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
    console.error("❌ Error updating picked quantities:", err);
    res.status(500).json({ error: err.message });
  }
});

// 5. API endpoint to update status
app.post("/api/update-status", async (req, res) => {
  const { picklistId, status, notes } = req.body;
  
  if (!picklistId) {
    return res.status(400).json({ error: "Picklist ID is required" });
  }
  
  if (!pool) {
    return res.status(503).json({ error: "Database not available" });
  }
  
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
    console.error("❌ Error updating status:", err);
    res.status(500).json({ error: err.message });
  }
});

// 6. API endpoint to delete picklist
app.post("/api/delete-picklist", async (req, res) => {
  const { picklistId } = req.body;
  
  if (!picklistId) {
    return res.status(400).json({ error: "Picklist ID is required" });
  }
  
  if (!pool) {
    return res.status(503).json({ error: "Database not available" });
  }
  
  try {
    const result = await pool.query(
      "DELETE FROM picklists WHERE picklist_data->>'picklist_number' = $1 RETURNING id",
      [picklistId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Picklist not found" });
    }
    
    res.json({ success: true, deleted: true });
  } catch (err) {
    console.error("❌ Error deleting picklist:", err);
    res.status(500).json({ error: err.message });
  }
});

// 7. API endpoint to get single picklist (for AJAX)
app.get("/api/picklist/:id", async (req, res) => {
  if (!pool) {
    return res.status(503).json({ error: "Database not available" });
  }
  
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
    console.error("❌ Error fetching picklist:", err);
    res.status(500).json({ error: err.message });
  }
});

// 8. Home page - Embedded only
app.get("/", (req, res) => {
  // Check if this is an embedded request
  const embedded = req.query.embedded === '1';

  if (embedded) {
    // Return minimal embedded interface
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Picklist App</title>
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; }
          .container { max-width: 1200px; margin: 0 auto; }
          .header { margin-bottom: 20px; }
          .stats { display: flex; gap: 20px; margin-bottom: 20px; }
          .stat-card { background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #e9ecef; }
          .stat-card h3 { margin: 0 0 5px 0; font-size: 24px; }
          .stat-card p { margin: 0; color: #6c757d; }
          .picklist-grid { display: grid; gap: 15px; }
          .picklist-card { background: white; border: 1px solid #e9ecef; border-radius: 8px; padding: 20px; }
          .picklist-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
          .picklist-header h3 { margin: 0; }
          .status { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
          .status-pending { background: #fff3cd; color: #856404; }
          .status-picking { background: #cce5ff; color: #004085; }
          .status-packed { background: #d1ecf1; color: #0c5460; }
          .status-shipped { background: #d4edda; color: #155724; }
          .items-list { margin-top: 15px; }
          .item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f8f9fa; }
          .item:last-child { border-bottom: none; }
          .item-info { flex: 1; }
          .item-title { font-weight: 500; margin: 0; }
          .item-sku { color: #6c757d; font-size: 14px; margin: 2px 0 0 0; }
          .item-quantity { font-weight: bold; color: #007bff; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📦 Picklist Manager</h1>
            <p>Manage your order picklists</p>
            <p style="margin-top: 12px; color: #4b5563; max-width: 760px; line-height: 1.6;">
              To create a picklist, open Shopify Admin → Orders, select one or more orders, then use the "Create Picklists" action from the Orders page.
            </p>
          </div>
          <div id="content">
            <p>Loading picklists...</p>
          </div>
        </div>

        <script>
          async function loadPicklists() {
            try {
              const response = await fetch('/api/picklists');
              const data = await response.json();

              if (data.error) {
                document.getElementById('content').innerHTML = '<p>Error loading picklists: ' + data.error + '</p>';
                return;
              }

              const picklists = data.picklists || [];
              const stats = data.stats || { total: 0, pending: 0, picking: 0, packed: 0, shipped: 0 };

              let html = \`
                <div class="stats">
                  <div class="stat-card">
                    <h3>\${stats.total}</h3>
                    <p>Total Picklists</p>
                  </div>
                  <div class="stat-card">
                    <h3>\${stats.pending}</h3>
                    <p>Pending</p>
                  </div>
                  <div class="stat-card">
                    <h3>\${stats.picking}</h3>
                    <p>In Progress</p>
                  </div>
                  <div class="stat-card">
                    <h3>\${stats.packed}</h3>
                    <p>Packed</p>
                  </div>
                  <div class="stat-card">
                    <h3>\${stats.shipped}</h3>
                    <p>Shipped</p>
                  </div>
                </div>

                <div class="picklist-grid">
              \`;

              if (picklists.length === 0) {
                html += '<div class="picklist-card"><p>No picklists yet. Create picklists from the Orders page.</p></div>';
              } else {
                picklists.forEach(picklist => {
                  const statusClass = \`status-\${picklist.status || 'pending'}\`;
                  const items = picklist.items || [];

                  html += \`
                    <div class="picklist-card">
                      <div class="picklist-header">
                        <h3>\${picklist.picklist_number}</h3>
                        <span class="\${statusClass} status">\${picklist.status || 'pending'}</span>
                      </div>
                      <p><strong>Order:</strong> \${picklist.order_info?.order_name || 'Unknown'}</p>
                      <p><strong>Created:</strong> \${new Date(picklist.created_at).toLocaleDateString()}</p>

                      <div class="items-list">
                        <h4>Items to Pick:</h4>
                  \`;

                  items.forEach(item => {
                    html += \`
                      <div class="item">
                        <div class="item-info">
                          <p class="item-title">\${item.title || 'Unknown product'}</p>
                          <p class="item-sku">SKU: \${item.sku || 'N/A'}</p>
                        </div>
                        <div class="item-quantity">Qty: \${item.quantity || 0}</div>
                      </div>
                    \`;
                  });

                  html += \`
                      </div>
                    </div>
                  \`;
                });
              }

              html += '</div>';
              document.getElementById('content').innerHTML = html;
            } catch (error) {
              document.getElementById('content').innerHTML = '<p>Error loading picklists: ' + error.message + '</p>';
            }
          }

          loadPicklists();
        </script>
      </body>
      </html>
    `);
    return;
  }

  // If not embedded, redirect to Shopify
  res.redirect('https://admin.shopify.com/store/YOUR_STORE/apps/YOUR_APP_ID');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ 
    error: "Internal server error", 
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).send(`
    <h1>404 - Page Not Found</h1>
    <p>The page you're looking for doesn't exist.</p>
    <a href="/">Go Home</a>
  `);
});

// Start server
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("\n" + "=".repeat(50));
  console.log(`✅ Server started successfully on port ${PORT}`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`📋 Picklists: http://localhost:${PORT}/view-picklists`);
  console.log("=".repeat(50) + "\n");
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(async () => {
    console.log('HTTP server closed');
    if (pool) {
      await pool.end();
      console.log('Database pool closed');
    }
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(async () => {
    console.log('HTTP server closed');
    if (pool) {
      await pool.end();
      console.log('Database pool closed');
    }
    process.exit(0);
  });
});
