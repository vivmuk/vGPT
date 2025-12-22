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

    // CORS headers for API routes
    app.use('/api', (req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            return res.sendStatus(200);
        }
        next();
    });

    // Log startup info
    console.log('=== Server Starting ===');
    console.log('Node version:', process.version);
    console.log('PORT:', PORT);
    console.log('VENICE_API_KEY:', VENICE_API_KEY ? `***${VENICE_API_KEY.slice(-4)}` : 'NOT SET!');
    console.log('DIST_DIR:', DIST_DIR);

    // Check dist directory
    if (fs.existsSync(DIST_DIR)) {
        const files = fs.readdirSync(DIST_DIR);
        console.log('dist contents:', files.length, 'files');
    } else {
        console.error('ERROR: dist directory does not exist!');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HEALTH & DEBUG ENDPOINTS
    // ═══════════════════════════════════════════════════════════════════════════

    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            apiKeyConfigured: !!VENICE_API_KEY
        });
    });

    // Debug endpoint to check configuration
    app.get('/api/debug', (req, res) => {
        res.json({
            apiKeySet: !!VENICE_API_KEY,
            apiKeyLength: VENICE_API_KEY ? VENICE_API_KEY.length : 0,
            apiKeyLast4: VENICE_API_KEY ? VENICE_API_KEY.slice(-4) : 'none',
            nodeVersion: process.version,
            distExists: fs.existsSync(DIST_DIR)
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // VENICE API PROXY ENDPOINTS
    // ═══════════════════════════════════════════════════════════════════════════

    // GET /api/models - List available models
    app.get('/api/models', async (req, res) => {
        if (!VENICE_API_KEY) {
            console.error('Models: VENICE_API_KEY not set');
            return res.status(500).json({ error: 'API key not configured' });
        }

        try {
            const url = req.query.type
                ? `${VENICE_API_BASE}/models?type=${req.query.type}`
                : `${VENICE_API_BASE}/models`;

            console.log('Fetching models from:', url);

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${VENICE_API_KEY}` }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Venice models error:', response.status, errorText);
                return res.status(response.status).json({ error: errorText });
            }

            const data = await response.json();
            console.log('Models fetched:', data?.data?.length || 0);
            res.json(data);
        } catch (err) {
            console.error('Models proxy error:', err.message);
            res.status(500).json({ error: 'Failed to fetch models', details: err.message });
        }
    });

    // POST /api/chat - Chat completions (supports streaming)
    app.post('/api/chat', async (req, res) => {
        if (!VENICE_API_KEY) {
            console.error('Chat: VENICE_API_KEY not set');
            return res.status(500).json({ error: 'API key not configured' });
        }

        try {
            console.log('Chat request for model:', req.body?.model);

            const response = await fetch(`${VENICE_API_BASE}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${VENICE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(req.body),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Venice chat error:', response.status, errorText);
                return res.status(response.status).json({ error: errorText });
            }

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
                    try {
                        while (true) {
                            const { value, done } = await reader.read();
                            if (done) {
                                res.end();
                                break;
                            }
                            const chunk = decoder.decode(value, { stream: true });
                            res.write(chunk);
                        }
                    } catch (streamErr) {
                        console.error('Stream read error:', streamErr.message);
                        res.end();
                    }
                };

                stream();

                // Handle client disconnect
                req.on('close', () => {
                    reader.cancel().catch(() => {});
                });
            } else {
                // Regular JSON response
                const data = await response.json();
                res.json(data);
            }
        } catch (err) {
            console.error('Chat proxy error:', err.message);
            res.status(500).json({ error: 'Failed to process chat request', details: err.message });
        }
    });

    // POST /api/image - Image generation
    app.post('/api/image', async (req, res) => {
        if (!VENICE_API_KEY) {
            console.error('Image: VENICE_API_KEY not set');
            return res.status(500).json({ error: 'API key not configured' });
        }

        try {
            console.log('Image generation for model:', req.body?.model);

            const response = await fetch(`${VENICE_API_BASE}/image/generate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${VENICE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(req.body),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Venice image error:', response.status, errorText);
                return res.status(response.status).json({ error: errorText });
            }

            const data = await response.json();
            console.log('Image generated successfully');
            res.json(data);
        } catch (err) {
            console.error('Image proxy error:', err.message);
            res.status(500).json({ error: 'Failed to generate image', details: err.message });
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // STATIC FILES & SPA FALLBACK
    // ═══════════════════════════════════════════════════════════════════════════

    // Serve static files with no cache for HTML to ensure fresh builds
    app.use(express.static(DIST_DIR, {
        extensions: ['html'],
        index: 'index.html',
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            }
        }
    }));

    // SPA fallback - must be last
    app.get('*', (req, res) => {
        // Don't serve index.html for API routes
        if (req.path.startsWith('/api/')) {
            return res.status(404).json({ error: 'Not found' });
        }

        const indexPath = path.join(DIST_DIR, 'index.html');
        if (fs.existsSync(indexPath)) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.sendFile(indexPath);
        } else {
            res.status(500).send('index.html not found - build may have failed');
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // START SERVER
    // ═══════════════════════════════════════════════════════════════════════════

    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log('=== Server Ready ===');
        console.log(`Listening on http://0.0.0.0:${PORT}`);
        console.log('Endpoints:');
        console.log('  GET  /health');
        console.log('  GET  /api/debug');
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
