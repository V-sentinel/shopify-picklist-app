const express = require('express');
const router = express.Router();

// Route for listing orders
router.get('/orders', (req, res) => {
    // Logic to list orders goes here
    res.send('List of orders');
});

// Route for creating a picklist
router.post('/picklist', (req, res) => {
    // Logic to create a picklist goes here
    res.send('Picklist created');
});

module.exports = router;