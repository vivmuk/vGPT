const express = require('express');
const path = require('path');
const fs = require('fs');

// Venice AI API Configuration
const VENICE_API_BASE = 'https://api.venice.ai/api/v1';
const VENICE_API_KEY = process.env.VENICE_API_KEY;

try {
    const app = express();
    const PORT = process.env.PORT || 3000;
    const DIST_DIR = path.join(__dirname, 'dist');

    // Parse JSON bodies
    app.use(express.json({ limit: '10mb' }));

    // Log startup info
    console.log('=== Server Starting ===');
    console.log('Node version:', process.version);
    console.log('PORT:', PORT);
    console.log('VENICE_API_KEY:', VENICE_API_KEY ? '***configured***' : 'NOT SET');

    // Check dist directory
    if (fs.existsSync(DIST_DIR)) {
        console.log('dist directory exists');
    } else {
        console.error('WARNING: dist directory does not exist!');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HEALTH CHECK
    // ═══════════════════════════════════════════════════════════════════════════

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // VENICE API PROXY ENDPOINTS
    // ═══════════════════════════════════════════════════════════════════════════

    // GET /api/models - List available models
    app.get('/api/models', async (req, res) => {
        try {
            const url = req.query.type
                ? `${VENICE_API_BASE}/models?type=${req.query.type}`
                : `${VENICE_API_BASE}/models`;

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${VENICE_API_KEY}` }
            });

            const data = await response.json();
            res.status(response.status).json(data);
        } catch (err) {
            console.error('Models proxy error:', err.message);
            res.status(500).json({ error: 'Failed to fetch models' });
        }
    });

    // POST /api/chat - Chat completions (supports streaming)
    app.post('/api/chat', async (req, res) => {
        try {
            const response = await fetch(`${VENICE_API_BASE}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${VENICE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(req.body),
            });

            // Check if streaming
            const contentType = response.headers.get('content-type') || '';

            if (contentType.includes('text/event-stream')) {
                // Stream the response
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Accel-Buffering', 'no');

                const reader = response.body.getReader();
                const decoder = new TextDecoder();

                const stream = async () => {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) {
                            res.end();
                            break;
                        }
                        const chunk = decoder.decode(value, { stream: true });
                        res.write(chunk);
                    }
                };

                stream().catch(err => {
                    console.error('Stream error:', err.message);
                    res.end();
                });

                // Handle client disconnect
                req.on('close', () => {
                    reader.cancel();
                });
            } else {
                // Regular JSON response
                const data = await response.json();
                res.status(response.status).json(data);
            }
        } catch (err) {
            console.error('Chat proxy error:', err.message);
            res.status(500).json({ error: 'Failed to process chat request' });
        }
    });

    // POST /api/image - Image generation
    app.post('/api/image', async (req, res) => {
        try {
            const response = await fetch(`${VENICE_API_BASE}/image/generate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${VENICE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(req.body),
            });

            const data = await response.json();
            res.status(response.status).json(data);
        } catch (err) {
            console.error('Image proxy error:', err.message);
            res.status(500).json({ error: 'Failed to generate image' });
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // STATIC FILES & SPA FALLBACK
    // ═══════════════════════════════════════════════════════════════════════════

    app.use(express.static(DIST_DIR, {
        extensions: ['html'],
        index: 'index.html',
        maxAge: '1d'
    }));

    // SPA fallback - must be last
    app.get('*', (req, res) => {
        const indexPath = path.join(DIST_DIR, 'index.html');
        if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            res.status(500).send('index.html not found');
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // START SERVER
    // ═══════════════════════════════════════════════════════════════════════════

    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log('=== Server Ready ===');
        console.log(`Listening on http://0.0.0.0:${PORT}`);
        console.log('API Endpoints:');
        console.log('  GET  /api/models');
        console.log('  POST /api/chat');
        console.log('  POST /api/image');
    });

    server.on('error', (err) => {
        console.error('Server error:', err);
        process.exit(1);
    });

    process.on('SIGTERM', () => {
        console.log('SIGTERM received');
        server.close(() => process.exit(0));
    });

} catch (err) {
    console.error('FATAL ERROR:', err);
    process.exit(1);
}
