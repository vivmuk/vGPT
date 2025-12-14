const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;
const DIST_DIR = path.join(__dirname, 'dist');

// Serve static files from the dist directory
app.use(express.static(DIST_DIR));

// Handle client-side routing, return all requests to the index.html unless it's a static file
app.get('*', (req, res) => {
    // If the request accepts html, give them index.html (SPA logic), 
    // but since we are static export, we might wanna try to find the .html file first.
    // Actually, express.static handles .html extension if configured, but let's be simple first.

    // For Expo Router static export, we often have directory/index.html or filename.html
    // Let's just send index.html for unknown routes if we want SPA behavior, 
    // OR 404 if we want accurate static serving.
    // Standard Expo web behavior is SPA-like if using 'server' output, but 'static' produces specific files.

    // Let's defer to index.html for anything not found, to support deep linking if JS handles it.
    res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`App listening on port ${PORT}`);
    console.log(`Serving content from ${DIST_DIR}`);
});
