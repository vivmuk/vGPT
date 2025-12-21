const express = require('express');
const path = require('path');
const fs = require('fs');

// Wrap everything in try-catch for better error visibility
try {
    const app = express();
    const PORT = process.env.PORT || 3000;
    const DIST_DIR = path.join(__dirname, 'dist');

    // Log startup info immediately
    console.log('=== Server Starting ===');
    console.log('Node version:', process.version);
    console.log('PORT:', PORT);
    console.log('DIST_DIR:', DIST_DIR);
    console.log('CWD:', process.cwd());

    // Check dist directory
    if (fs.existsSync(DIST_DIR)) {
        console.log('dist directory exists');
        try {
            const contents = fs.readdirSync(DIST_DIR);
            console.log('dist contents:', contents.join(', '));
        } catch (err) {
            console.error('Error reading dist directory:', err.message);
        }
    } else {
        console.error('WARNING: dist directory does not exist!');
        console.log('Available files in root:', fs.readdirSync(__dirname).join(', '));
    }

    // Health check endpoint - MUST be first
    app.get('/health', (req, res) => {
        console.log('Health check requested');
        res.status(200).json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
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
        console.log('=== Server Ready ===');
        console.log(`Listening on http://0.0.0.0:${PORT}`);
        console.log(`Health check: http://0.0.0.0:${PORT}/health`);
    });

    // Handle server errors
    server.on('error', (err) => {
        console.error('Server error:', err);
        process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('SIGTERM received, shutting down gracefully');
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    });

} catch (err) {
    console.error('FATAL ERROR during server startup:', err);
    process.exit(1);
}
