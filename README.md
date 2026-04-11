# Shopify Picklist App

A Shopify app that creates organized picklists from selected orders to streamline fulfillment processes.

## 🚀 Quick Start

### 1. Deploy to Railway
1. Fork this repository
2. Connect to Railway and deploy
3. Set environment variables in Railway dashboard

### 2. Create Shopify App
1. Go to [Shopify Partners Dashboard](https://partners.shopify.com)
2. Create a new app
3. Set **App URL** to: `https://your-app-name.onrender.com`
4. Set **Allowed redirection URL(s)** to: `https://your-app-name.onrender.com/auth/callback`

### 3. Configure Environment Variables
In your Railway project, set:
```
SHOPIFY_CLIENT_ID=your_client_id_from_partners
SHOPIFY_CLIENT_SECRET=your_client_secret_from_partners
DATABASE_URL=your_postgresql_connection_string
```

### 4. Install the App
1. In Shopify Partners, go to your app → Test your app
2. Install on a development store
3. Or use the install URL: `https://your-app-name.onrender.com/install?shop=yourstore.myshopify.com`

## 📋 How to Use

1. **Install the app** on your Shopify store
2. **Go to Shopify Admin → Orders**
3. **Select one or more orders** using checkboxes
4. **Click "Create Picklist"** button that appears
5. **View and manage picklists** at `/view-picklists`

## 🔧 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SHOPIFY_CLIENT_ID` | From Shopify Partners Dashboard | ✅ |
| `SHOPIFY_CLIENT_SECRET` | From Shopify Partners Dashboard | ✅ |
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | For development/testing | ❌ |
| `SHOP_NAME` | Your Shopify store name | ❌ |

## 🛠 Development

### Local Development
```bash
npm install
npm start
```

### Testing OAuth
- Visit `http://localhost:3000/install?shop=yourstore.myshopify.com`
- This generates the OAuth install URL for testing

### Extension Development
The UI extension is in `extensions/picklist-extension/`. To deploy:
```bash
npm install -g @shopify/cli
shopify app dev
```

## 🐛 Troubleshooting

### Extension Not Showing?
1. **App must be installed** via OAuth (not just added to Partners)
2. **Extension needs deployment** - use `shopify app dev` for development
3. **Check permissions** - app needs: `read_orders, write_draft_orders, read_customers, write_fulfillments`
4. **Correct targeting** - extension targets `admin.order-index.selection-action`

### OAuth Issues?
1. **Check environment variables** - all required vars must be set
2. **Verify app URLs** in Partners Dashboard match your deployment
3. **Test install URL** - use `/install?shop=yourstore.myshopify.com`

### Database Issues?
1. **PostgreSQL required** - set `DATABASE_URL` in Railway
2. **SSL enabled** - Railway provides SSL-enabled connections
3. **Tables created automatically** on first run

## 📊 API Endpoints

- `GET /` - Home page
- `GET /health` - Health check
- `GET /install?shop=store.myshopify.com` - Generate install URL
- `GET /auth?shop=store.myshopify.com` - Start OAuth flow
- `GET /auth/callback` - OAuth callback
- `POST /api/bulk-action` - Create picklists (called by extension)
- `GET /view-picklists` - View all picklists

## 🏗 Architecture

- **Backend**: Node.js + Express
- **Database**: PostgreSQL
- **Authentication**: Shopify OAuth 2.0
- **UI Extension**: React + Shopify UI Extensions
- **Deployment**: Railway (recommended)

## 📝 Features

- ✅ OAuth installation flow
- ✅ Order selection extension
- ✅ Picklist generation
- ✅ Database storage
- ✅ Web interface for management
- ✅ Embedded app support
- ✅ Error handling and logging
3. The extension should then appear in the Orders section

### Manual Testing

You can also test the backend directly:
- Visit `https://your-app-url.com/health` to check if the app is running
- Visit `https://your-app-url.com/view-picklists` to see the picklist management interface
