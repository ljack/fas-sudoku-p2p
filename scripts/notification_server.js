const http = require('http');
const { exec } = require('child_process');

const PORT = process.env.PORT || 9090;

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        console.log('\n[Notification Server] Received deployment ping:', payload);

        const repo = payload.repository || 'Unknown Repository';
        const url = payload.url || '';

        // Trigger native macOS notification
        const title = 'GitHub Pages Deployed';
        const message = `${repo} is now live!\n${url}`;
        
        // Execute AppleScript to display notification and play a sound
        const appleScript = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}" sound name "Glass"`;
        exec(`osascript -e '${appleScript}'`);

        // Automatically open the deployed URL in the default browser
        if (url) {
          console.log(`🌐 Opening URL: ${url}`);
          exec(`open "${url}"`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (err) {
        console.error('[Notification Server] Error parsing JSON:', err);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid JSON');
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 Notification server listening on port ${PORT}`);
  console.log(`To tunnel this server with ngrok, run:`);
  console.log(`  ngrok http ${PORT}`);
  console.log(`Then set the ngrok URL as DEPLOY_PING_URL in your GitHub repository secrets.`);
});
