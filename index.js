// Add CORS support (install cors package first)
import cors from 'cors';

app.use(cors({
  origin: ['https://*.myshopify.com', 'https://*.shopifyapps.com'],
  credentials: true
}));

// Handle authenticated requests from the UI Extension
app.post("/api/bulk-action", async (req, res) => {
  const { ids } = req.body;
  
  console.log(`📋 Bulk action from extension with ${ids?.length || 0} order(s)`);
  
  if (!ids || ids.length === 0) {
    return res.status(400).json({ error: "No order IDs provided" });
  }

  if (!pool) {
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
        }
      } catch (err) {
        console.error(`Failed to create picklist for order ${id}:`, err.message);
      }
    }
    
    res.json({ 
      success: true, 
      count: picklists.length,
      picklists: picklists.map(p => p.picklist_number)
    });
  } catch (err) {
    console.error("❌ Bulk action error:", err);
    res.status(500).json({ error: err.message });
  }
});
