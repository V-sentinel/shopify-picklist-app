'use strict';

const express = require('express');
const router = express.Router();

// Sample data structure for batches
let batches = [];

// Create a new batch
router.post('/batches', (req, res) => {
    const { name, items } = req.body;
    const newBatch = { id: batches.length + 1, name, items };
    batches.push(newBatch);
    res.status(201).json(newBatch);
});

// View all batches
router.get('/batches', (req, res) => {
    res.json(batches);
});

// Delete a batch
router.delete('/batches/:id', (req, res) => {
    const { id } = req.params;
    batches = batches.filter(batch => batch.id !== parseInt(id));
    res.status(204).send();
});

// Export batches to CSV
router.get('/batches/export/csv', (req, res) => {
    const csvRows = [];
    const headers = 'ID,Name,Items';
    csvRows.push(headers);

    batches.forEach(batch => {
        const values = `${batch.id},${batch.name},${batch.items.join(';')}`;
        csvRows.push(values);
    });

    res.header('Content-Type', 'text/csv');
    res.attachment('batches.csv');
    res.send(csvRows.join('\n'));
});

module.exports = router;
