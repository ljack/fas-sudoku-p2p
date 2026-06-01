const fs = require('fs');
const path = require('path');

const distStaticDir = path.join(__dirname, '../dist-static');

console.log('[Static Builder] Building self-contained static app for GitHub Pages...');

// Create dist-static directory if not exists
if (!fs.existsSync(distStaticDir)) {
  fs.mkdirSync(distStaticDir, { recursive: true });
}

// Copy Files
const filesToCopy = [
  { src: '../features/sudoku/public/index.html', dest: 'index.html' },
  { src: '../features/sudoku/public/styles.css', dest: 'styles.css' },
  { src: '../features/sudoku/public/app.js', dest: 'app.js' },
  { src: '../features/sudoku/public/qrcode.min.js', dest: 'qrcode.min.js' },
  { src: '../features/coop/public/inject.js', dest: 'inject.js' },
  { src: '../features/coop/public/inject.css', dest: 'inject.css' }
];

filesToCopy.forEach(file => {
  const srcPath = path.join(__dirname, file.src);
  const destPath = path.join(distStaticDir, file.dest);
  
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`[Static Builder] Copied ${file.dest}`);
  } else {
    console.warn(`[Static Builder] Warning: Source file ${srcPath} not found.`);
  }
});

// Post-Process index.html for relative paths
const htmlPath = path.join(distStaticDir, 'index.html');
if (fs.existsSync(htmlPath)) {
  let html = fs.readFileSync(htmlPath, 'utf8');
  
  // Replace absolute assets paths with relative paths
  html = html.replace('/sudoku-client/styles.css', 'styles.css');
  html = html.replace('/sudoku-client/app.js', 'app.js');
  html = html.replace('/sudoku-client/qrcode.min.js', 'qrcode.min.js');
  
  // Inject coop features statically (since there is no Express context replacement)
  const coopInject = `
  <link rel="stylesheet" href="inject.css">
  <script src="inject.js" defer></script>
  `;
  html = html.replace('<!-- FAS_INJECT -->', coopInject);
  
  fs.writeFileSync(htmlPath, html);
  console.log('[Static Builder] index.html successfully compiled with relative paths and static injections.');
} else {
  console.error('[Static Builder] Error: index.html not found in dist-static!');
}

console.log('[Static Builder] Build complete in dist-static/.');
