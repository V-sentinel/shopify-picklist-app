// utils/shopify.js

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Token caching
const tokenCachePath = path.resolve(__dirname, 'tokenCache.json');

function readTokenFromCache() {
    if (fs.existsSync(tokenCachePath)) {
        const data = fs.readFileSync(tokenCachePath, 'utf-8');
        return JSON.parse(data).token;
    }
    return null;
}

function writeTokenToCache(token) {
    fs.writeFileSync(tokenCachePath, JSON.stringify({ token }), 'utf-8');
}

// Shopify API functions
async function getShopifyData(endpoint) {
    const token = readTokenFromCache();
    if (!token) {
        throw new Error('No token found in cache');
    }

    const response = await axios.get(`https://your-shopify-store.myshopify.com/admin/api/2021-01/${endpoint}`, {
        headers: {
            'X-Shopify-Access-Token': token,
        },
    });
    return response.data;
}

module.exports = {
    readTokenFromCache,
    writeTokenToCache,
    getShopifyData,
};