import express from 'express';
import { Shopify } from '@shopify/shopify-api';
import { PostgreSQLSessionStorage } from '@shopify/shopify-app-session-storage-postgresql';
import { shopifyApp } from '@shopify/shopify-app-express';

const app = express();

// Shopify config using CLIENT ID & SECRET (not old access token)
const shopify = shopifyApp({
  api: {
    apiKey: process.env.SHOPIFY_API_KEY,        // Client ID
    apiSecretKey: process.env.SHOPIFY_API_SECRET, // Client Secret
    scopes: process.env.SCOPES.split(','),
    hostName: process.env.HOST.replace(/https:\/\//, ''),
    hostScheme: 'https',
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

// Your app routes (protected by OAuth)
app.get('/api/orders', shopify.authenticate.admin, async (req, res) => {
  const session = res.locals.shopify.session;
  const client = new shopify.api.clients.Graphql({ session });
  
  // GraphQL query for orders
  const orders = await client.query({
    data: `{
      orders(first: 10) {
        edges {
          node {
            id
            name
            createdAt
            customer { displayName }
            totalPriceSet { presentmentMoney { amount } }
          }
        }
      }
    }`
  });
  
  res.json(orders);
});

// Picklist route (protected)
app.get('/api/picklists', shopify.authenticate.admin, async (req, res) => {
  // Your picklist logic here
  res.json({ picklists: [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 App running on port ${PORT}`);
});
