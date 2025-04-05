// Import necessary Node.js modules
const http = require('http'); // Module for creating HTTP servers
const fs = require('fs');     // Module for interacting with the file system
const path = require('path'); // Module for working with file and directory paths

// Define the port the server will listen on
const PORT = 3000;

// Create the HTTP server
const server = http.createServer((req, res) => {
    // Log the requested URL
    console.log(`Request received for: ${req.url}`);

    // Determine the file path based on the request URL
    // If the root path '/' is requested, serve 'index.html'
    // Otherwise, serve the requested file relative to the current directory
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);

    // Determine the file extension to set the correct Content-Type header
    let extname = path.extname(filePath);
    let contentType = 'text/html'; // Default content type

    switch (extname) {
        case '.js':
            contentType = 'text/javascript';
            break;
        case '.css': // Added basic CSS handling as well
            contentType = 'text/css';
            break;
        case '.json':
            contentType = 'application/json';
            break;
        case '.png':
            contentType = 'image/png';
            break;
        case '.jpg':
            contentType = 'image/jpg';
            break;
        // Add more MIME types as needed
    }

    // Read the requested file from the file system
    fs.readFile(filePath, (err, content) => {
        if (err) {
            // Handle errors, specifically file not found (ENOENT)
            if (err.code == 'ENOENT') {
                // If the file doesn't exist, send a 404 Not Found response
                fs.readFile(path.join(__dirname, '404.html'), (error404, content404) => {
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    if (error404) {
                        // Fallback if 404.html is also missing
                        res.end('404 Not Found', 'utf-8');
                    } else {
                        res.end(content404, 'utf-8');
                    }
                });
            } else {
                // For other server errors, send a 500 Internal Server Error response
                res.writeHead(500);
                res.end(`Server Error: ${err.code}`);
            }
        } else {
            // If the file is found and read successfully, send a 200 OK response
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8'); // Serve the file content
        }
    });
});

// Start the server and listen on the specified port
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Serving files from directory: ${__dirname}`);
});
