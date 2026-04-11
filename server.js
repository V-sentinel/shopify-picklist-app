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

// ================= ROUTES =================

// Health check endpoint (useful for Render)
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    database: pool ? "connected" : "disabled",
    shop: SHOP || "not configured"
  });
});

// 1. Bulk Action → Creates picklist for selected orders
app.get("/bulk-action", async (req, res) => {
  const ids = req.query.ids ? req.query.ids.split(",") : [];
  
  console.log(`📋 Bulk action triggered with ${ids.length} order(s):`, ids);
  
  if (ids.length === 0) {
    console.warn("⚠️ No order IDs provided");
    return res.redirect("/view-picklists?error=no_orders");
  }

  if (!pool) {
    console.error("❌ Cannot create picklist - database not available");
    return res.status(503).send(`
      <h1>Database Not Available</h1>
      <p>Please configure DATABASE_URL in environment variables.</p>
      <a href="/">Go Home</a>
    `);
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
    res.redirect(`/view-picklists?success=${encodeURIComponent(picklists.length)}&highlight=${encodeURIComponent(idsParam)}`);
  } catch (err) {
    console.error("❌ Bulk action error:", err);
    res.status(500).send(`
      <h1>Error Creating Picklist</h1>
      <p>${err.message}</p>
      <pre>${err.stack}</pre>
      <a href="/view-picklists">View Existing Picklists</a><br>
      <a href="/">Go Home</a>
    `);
  }
});

// 2. View Saved Picklists with detailed view
app.get("/view-picklists", async (req, res) => {
  const successCount = req.query.success;
  const error = req.query.error;
  const highlightPicklist = req.query.highlight || '';
  
  if (!pool) {
    return res.status(503).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Database Error</title></head>
      <body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h1>⚠️ Database Not Configured</h1>
        <p>Please set the DATABASE_URL environment variable in Render.</p>
        <p>You need to create a PostgreSQL database and add the connection string.</p>
        <a href="/">Go Home</a>
      </body>
      </html>
    `);
  }
  
  try {
    const result = await pool.query(
      "SELECT * FROM picklists ORDER BY created_at DESC"
    );
    
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
          .alert {
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            animation: slideDown 0.3s ease;
          }
          @keyframes slideDown {
            from { transform: translateY(-20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
          .alert-success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
          }
          .alert-error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
          }
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
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            align-items: center;
          }
          .filters input, .filters select {
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
          }
          .filters input { flex: 1; min-width: 200px; }
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
            flex-wrap: wrap;
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
          .status-select {
            padding: 8px 15px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
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
          @media (max-width: 768px) {
            .stats { flex-direction: column; }
            .filters { flex-direction: column; align-items: stretch; }
            .filters input, .filters select { width: 100%; }
            .items-table { font-size: 12px; }
            .items-table th, .items-table td { padding: 8px; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📦 Picklist Manager</h1>
            <p>Manage and track your order fulfillment picklists</p>
    `;
    
    if (successCount) {
      html += `<div class="alert alert-success">✅ Successfully created ${successCount} picklist(s)!</div>`;
    }
    if (error) {
      html += `<div class="alert alert-error">⚠️ Error: ${error.replace(/_/g, ' ')}</div>`;
    }
    
    const pendingCount = result.rows.filter(r => r.picklist_data?.status === 'pending').length;
    const pickingCount = result.rows.filter(r => r.picklist_data?.status === 'picking').length;
    const packedCount = result.rows.filter(r => r.picklist_data?.status === 'packed').length;
    const shippedCount = result.rows.filter(r => r.picklist_data?.status === 'shipped').length;
    
    html += `
            <div class="stats">
              <div class="stat-card">
                <h3>${result.rows.length}</h3>
                <p>Total Picklists</p>
              </div>
              <div class="stat-card">
                <h3>${pendingCount}</h3>
                <p>Pending</p>
              </div>
              <div class="stat-card">
                <h3>${pickingCount}</h3>
                <p>In Progress</p>
              </div>
              <div class="stat-card">
                <h3>${packedCount}</h3>
                <p>Packed</p>
              </div>
              <div class="stat-card">
                <h3>${shippedCount}</h3>
                <p>Shipped</p>
              </div>
            </div>
          </div>
          
          <div class="filters">
            <input type="text" id="searchInput" placeholder="🔍 Search by order #, customer, or picklist #...">
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
    
    if (result.rows.length === 0) {
      html += `
        <div style="text-align: center; padding: 60px; background: white; border-radius: 12px;">
          <h3>📭 No picklists yet</h3>
          <p>Go to Shopify Admin → Orders → Select orders → Click "Create Picklist"</p>
          <a href="/" style="color: #008060;">Return to Home</a>
        </div>
      `;
    }
    
    for (const row of result.rows) {
      const picklist = row.picklist_data || (row.order_data ? createPicklistData(row.order_data) : {
        picklist_number: 'UNKNOWN',
        created_at: new Date().toISOString(),
        status: 'pending',
        order_info: {
          order_name: row.order_name || 'Unknown order'
        },
        items: []
      });
      const isHighlight = highlightPicklist.includes(picklist.picklist_number);
      const statusClass = `status-${picklist.status || 'pending'}`;
      
      html += `
        <div class="picklist-card ${isHighlight ? 'highlight' : ''}" data-picklist-id="${picklist.picklist_number}" data-status="${picklist.status || 'pending'}">
          <div class="picklist-header" onclick="togglePicklist('${picklist.picklist_number}')">
            <div>
              <h3>${escapeHtml(picklist.picklist_number)}</h3>
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
                  <p><strong>Name:</strong> ${escapeHtml(picklist.customer.name)}</p>
                  <p><strong>Email:</strong> ${escapeHtml(picklist.customer.email || 'N/A')}</p>
                  <p><strong>Phone:</strong> ${escapeHtml(picklist.customer.phone || 'N/A')}</p>
                ` : '<p>No customer information</p>'}
              </div>
              <div class="info-section">
                <h4>📮 Shipping Address</h4>
                ${picklist.shipping_address ? `
                  <p>${escapeHtml(picklist.shipping_address.name || '')}</p>
                  <p>${escapeHtml(picklist.shipping_address.address1 || '')}</p>
                  ${picklist.shipping_address.address2 ? `<p>${escapeHtml(picklist.shipping_address.address2)}</p>` : ''}
                  <p>${escapeHtml(picklist.shipping_address.city || '')}, ${escapeHtml(picklist.shipping_address.province || '')} ${escapeHtml(picklist.shipping_address.zip || '')}</p>
                  <p>${escapeHtml(picklist.shipping_address.country || '')}</p>
                ` : '<p>No shipping address</p>'}
              </div>
              <div class="info-section">
                <h4>📋 Order Details</h4>
                <p><strong>Order Status:</strong> ${picklist.order_info.financial_status || 'N/A'}</p>
                <p><strong>Fulfillment:</strong> ${picklist.order_info.fulfillment_status || 'Not fulfilled'}</p>
                <p><strong>Total:</strong> ${picklist.currency} ${picklist.total_price}</p>
                ${picklist.order_info.tags ? `<p><strong>Tags:</strong> ${escapeHtml(picklist.order_info.tags)}</p>` : ''}
              </div>
            </div>
            
            <h4>🛍️ Items to Pick</h4>
            <table class="items-table">
              <thead>
                <tr><th>SKU</th><th>Product</th><th>Variant</th><th>Required</th><th>Picked</th><th>Location</th></tr>
              </thead>
              <tbody>
      `;
      
      for (const item of picklist.items) {
        const pickedQty = item.picked_quantity || 0;
        html += `
          <tr>
            <td>${escapeHtml(item.sku)}</td>
            <td>${escapeHtml(item.title)}</td>
            <td>${escapeHtml(item.variant_title || '-')}</td>
            <td>${item.quantity}</td>
            <td>
              <input type="number" class="quantity-input" data-picklist="${picklist.picklist_number}" data-sku="${escapeHtml(item.sku)}" value="${pickedQty}" min="0" max="${item.quantity}">
              <span style="font-size: 12px; color: ${pickedQty === item.quantity ? '#28a745' : '#dc3545'}">
                ${pickedQty === item.quantity ? '✓ Complete' : `${item.quantity - pickedQty} left`}
              </span>
            </td>
            <td>${escapeHtml(item.location)}</td>
          </tr>
        `;
      }
      
      html += `
              </tbody>
            </table>
            
            <div>
              <label><strong>📝 Picklist Notes:</strong></label>
              <textarea class="notes-area" id="notes-${picklist.picklist_number}" rows="3" placeholder="Add any notes about this picklist...">${escapeHtml(picklist.notes || '')}</textarea>
            </div>
            
            <div class="action-buttons">
              <button class="btn-print" onclick="printPicklist('${picklist.picklist_number}')">🖨️ Print</button>
              <button class="btn-success" onclick="updatePickedQuantities('${picklist.picklist_number}')">✓ Update Picked</button>
              <select id="status-${picklist.picklist_number}" class="status-select">
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
            const inputs = document.querySelectorAll(\`input[data-picklist="\${picklistId}"]\`);
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
              alert('✅ Picked quantities updated successfully!');
              location.reload();
            } else {
              const error = await response.text();
              alert('❌ Error updating picked quantities: ' + error);
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
              alert('✅ Status updated successfully!');
              location.reload();
            } else {
              alert('❌ Error updating status');
            }
          }
          
          async function deletePicklist(picklistId) {
            if (confirm('⚠️ Are you sure you want to delete this picklist? This action cannot be undone.')) {
              const response = await fetch('/api/delete-picklist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ picklistId })
              });
              
              if (response.ok) {
                alert('✅ Picklist deleted successfully');
                location.reload();
              } else {
                alert('❌ Error deleting picklist');
              }
            }
          }
          
          function exportToCSV() {
            const rows = [['Picklist #', 'Order #', 'Customer', 'SKU', 'Product', 'Quantity', 'Status', 'Created Date']];
            const cards = document.querySelectorAll('.picklist-card');
            cards.forEach(card => {
              const picklistId = card.querySelector('.picklist-header h3').innerText;
              const orderText = card.querySelector('.picklist-header p').innerText;
              const orderName = orderText.split('|')[0].trim();
              const customerName = card.querySelector('.info-section:first-child p:first-child')?.innerText.replace('Name:', '').trim() || 'N/A';
              const status = card.querySelector('.status').innerText;
              const createdDate = orderText.split('|')[1]?.trim() || '';
              const items = card.querySelectorAll('.items-table tbody tr');
              items.forEach(item => {
                const sku = item.cells[0].innerText;
                const product = item.cells[1].innerText;
                const quantity = item.cells[3].innerText;
                rows.push([picklistId, orderName, customerName, sku, product, quantity, status, createdDate]);
              });
            });
            
            const csvContent = rows.map(row => row.map(cell => \`"\${String(cell).replace(/"/g, '""')}"\`).join(',')).join('\\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`picklists_export_\${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.csv\`;
            a.click();
            URL.revokeObjectURL(url);
          }
          
          // Filter functionality
          const searchInput = document.getElementById('searchInput');
          const statusFilter = document.getElementById('statusFilter');
          
          if (searchInput) searchInput.addEventListener('input', filterPicklists);
          if (statusFilter) statusFilter.addEventListener('change', filterPicklists);
          
          function filterPicklists() {
            const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
            const statusFilterValue = document.getElementById('statusFilter')?.value || '';
            const cards = document.querySelectorAll('.picklist-card');
            
            cards.forEach(card => {
              const text = card.innerText.toLowerCase();
              const status = card.dataset.status;
              const matchesSearch = text.includes(searchTerm);
              const matchesStatus = !statusFilterValue || status === statusFilterValue;
              
              card.style.display = (matchesSearch && matchesStatus) ? '' : 'none';
            });
          }
          
          // Open first picklist by default on mobile
          if (window.innerWidth <= 768 && document.querySelector('.picklist-card')) {
            const firstId = document.querySelector('.picklist-card .picklist-header h3').innerText;
            togglePicklist(firstId);
          }
        </script>
      </body>
      </html>
    `;
    
    res.send(html);
  } catch (err) {
    console.error("❌ Error loading picklists:", err);
    res.status(500).send(`
      <h1>Error Loading Picklists</h1>
      <p>${err.message}</p>
      <pre>${err.stack}</pre>
      <a href="/">Go Home</a>
    `);
  }
});

// Helper function to escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

// 8. Home page
app.get("/", (req, res) => {
  // Check if this is an embedded request
  const embedded = req.query.embedded === '1';

  if (embedded) {
    // Return a minimal embedded interface
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Picklist App</title>
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
      </head>
      <body>
        <div id="app">
          <h1>📦 Picklist App</h1>
          <p>Manage your order picklists</p>
          <a href="/view-picklists" target="_blank">Open Picklist Manager</a>
        </div>
      </body>
      </html>
    `);
    return;
  }

  // Regular web interface
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Picklist App - Shopify Order Fulfillment</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          background: white;
          border-radius: 20px;
          padding: 50px;
          max-width: 650px;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          animation: fadeInUp 0.6s ease;
        }
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        h1 {
          color: #008060;
          font-size: 48px;
          margin-bottom: 10px;
        }
        .emoji {
          font-size: 64px;
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
          transition: all 0.3s;
          margin: 5px;
        }
        .button:hover {
          background: #004c3f;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        .button-outline {
          background: transparent;
          border: 2px solid #008060;
          color: #008060;
        }
        .button-outline:hover {
          background: #008060;
          color: white;
        }
        .steps {
          text-align: left;
          background: #f8f9fa;
          padding: 25px;
          border-radius: 10px;
          margin-top: 30px;
        }
        .steps h3 {
          color: #333;
          margin-bottom: 15px;
        }
        .steps ol {
          margin-left: 20px;
          color: #666;
        }
        .steps li {
          margin: 10px 0;
        }
        .status-badge {
          display: inline-block;
          background: #e8f5e9;
          color: #2e7d32;
          padding: 5px 10px;
          border-radius: 5px;
          font-size: 12px;
          margin-top: 20px;
        }
        @media (max-width: 600px) {
          .container { padding: 30px 20px; }
          h1 { font-size: 32px; }
          .button { display: block; margin: 10px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="emoji">📦</div>
        <h1>Picklist App</h1>
        <p>Streamline your order fulfillment process with organized picklists</p>
        <div>
          <a href="/view-picklists" class="button">View All Picklists →</a>
          <a href="/health" class="button button-outline">Health Check</a>
        </div>
        <div class="steps">
          <h3>📋 How to use:</h3>
          <ol>
            <li>Go to <strong>Shopify Admin → Orders</strong></li>
            <li>Select one or more orders using checkboxes</li>
            <li>Click the <strong>Create Picklist</strong> button that appears</li>
            <li>View and manage your picklists below</li>
          </ol>
        </div>
        <div class="status-badge">
          ✅ App is running | ${SHOP ? `Shop: ${SHOP}` : 'No shop configured'}
        </div>
      </div>
    </body>
    </html>
  `);
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
