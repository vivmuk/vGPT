const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DIST_DIR = path.join(__dirname, 'dist');

// Log startup info
console.log('Starting server...');
console.log('PORT:', PORT);
console.log('DIST_DIR:', DIST_DIR);

// Check dist directory
if (fs.existsSync(DIST_DIR)) {
    console.log('dist directory exists');
    try {
        const contents = fs.readdirSync(DIST_DIR);
        console.log('Contents:', contents);
    } catch (err) {
        console.error('Error reading dist directory:', err);
    }
} else {
    console.error('ERROR: dist directory does not exist!');
}

// Health check endpoint (must be before static files)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files from dist directory
app.use(express.static(DIST_DIR, {
    extensions: ['html'],
    index: 'index.html',
    maxAge: '1d'
}));

// SPA fallback - serve index.html for all unmatched routes
app.get('*', (req, res) => {
    const indexPath = path.join(DIST_DIR, 'index.html');

    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(500).send('index.html not found. Build may have failed.');
    }
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Serving static files from ${DIST_DIR}`);
    console.log('Server ready to accept connections');
});

// Handle server errors
server.on('error', (err) => {
    console.error('Server error:', err);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
