const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

const PORT = process.env.PORT || 3000;
const DIST_DIR = path.join(__dirname, 'dist');

// Log dist directory contents for debugging
console.log('Checking dist directory...');
if (fs.existsSync(DIST_DIR)) {
    console.log('dist directory exists');
    console.log('Contents:', fs.readdirSync(DIST_DIR));
} else {
    console.error('ERROR: dist directory does not exist!');
}

// Serve static files from the dist directory
app.use(express.static(DIST_DIR, {
    extensions: ['html'],
    index: 'index.html'
}));

// Handle client-side routing - serve index.html for all unmatched routes
app.get('(.*)', (req, res) => {
    const indexPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(500).send('index.html not found. Build may have failed.');
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`App listening on port ${PORT}`);
    console.log(`Serving content from ${DIST_DIR}`);
});
