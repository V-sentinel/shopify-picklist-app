'use strict';

const { body, validationResult } = require('express-validator');

// Middleware for input validation and XSS protection
exports.inputValidation = [
    body('field1')
        .isString().withMessage('Field1 must be a string')
        .trim()
        .escape(),
    body('field2')
        .isEmail().withMessage('Field2 must be a valid email'),
    // Add more fields as needed
];

exports.validateResults = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

// XSS protection middleware can be added here if necessary
