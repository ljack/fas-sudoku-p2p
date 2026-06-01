// Parse URL hash to extract game variables
function parseHash() {
  const hash = window.location.hash.substring(1);
  if (!hash) return {};
  const params = {};
  hash.split('&').forEach(pair => {
    const [key, val] = pair.split('=');
    if (key && val) {
      params[key] = decodeURIComponent(val);
    }
  });
  return params;
}

const hashParams = parseHash();
const hasOfferInHash = !!hashParams.offer;
const isHost = !hasOfferInHash;

// Extract gameId
let gameId = hashParams.gameId;
if (!gameId) {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const lastPart = pathParts.pop();
  if (lastPart && lastPart !== 'sudoku' && lastPart !== 'index.html') {
    gameId = lastPart;
  }
}
if (!gameId) {
  gameId = 'game_' + Math.random().toString(36).substring(2, 9);
}

document.getElementById('game-id').textContent = gameId;

let initialGrid = "";
let currentGrid = "";

// Built-in library of base puzzles (81 chars, 0 = empty)
const BASE_PUZZLES = [
  // Easy
  "530070000600195000098000060800060003400803001700020006060000280000419005000080079",
  // Medium
  "000600400700003600000091080000000000050180003000306045040200060903000000020000100",
  // Hard
  "000800000400015000029600803000000285000000000236000000801006490000530002000004000",
  // Medium 2
  "300000080001093000040020060400000290076000130092000004080050010000680400020000009",
  // Hard 2
  "800000000003600000070090200050007000000045700000100030001000068008500010090000400"
];

// Standard backtracking Sudoku solver
function solveSudoku(grid) {
  const board = [...grid];
  if (solveHelper(board)) {
    return board;
  }
  return null;
}

function solveHelper(board) {
  for (let i = 0; i < 81; i++) {
    if (board[i] === 0) {
      for (let val = 1; val <= 9; val++) {
        if (isValid(board, i, val)) {
          board[i] = val;
          if (solveHelper(board)) {
            return true;
          }
          board[i] = 0;
        }
      }
      return false;
    }
  }
  return true;
}

function isValid(board, idx, val) {
  const r = Math.floor(idx / 9);
  const c = idx % 9;
  
  // Check row
  for (let i = 0; i < 9; i++) {
    if (board[r * 9 + i] === val) return false;
  }
  
  // Check col
  for (let i = 0; i < 9; i++) {
    if (board[i * 9 + c] === val) return false;
  }
  
  // Check 3x3 box
  const boxRow = Math.floor(r / 3) * 3;
  const boxCol = Math.floor(c / 3) * 3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (board[(boxRow + i) * 9 + (boxCol + j)] === val) return false;
    }
  }
  
  return true;
}

// Select DOM elements
const gridContainer = document.getElementById('sudoku-grid');
const statusBadge = document.getElementById('game-status');
const btnReset = document.getElementById('btn-reset');
const btnNew = document.getElementById('btn-new');
const btnSolve = document.getElementById('btn-solve');

// P2P Console DOM Elements
const p2pStatusBadge = document.getElementById('p2p-status-badge');
const p2pIndicatorDot = document.getElementById('p2p-indicator-dot');
const profileColor = document.getElementById('profile-color');
const profileNickname = document.getElementById('profile-nickname');
const profileRole = document.getElementById('profile-role');
const networkTypeBadge = document.getElementById('network-type-badge');
const discoveredIps = document.getElementById('discovered-ips');
const btnModeAuto = document.getElementById('btn-mode-auto');
const btnModeManual = document.getElementById('btn-mode-manual');
const modeDesc = document.getElementById('mode-desc');
const manualPanel = document.getElementById('manual-panel');
const btnManualOffer = document.getElementById('btn-manual-offer');
const localSdpText = document.getElementById('local-sdp-text');
const remoteSdpText = document.getElementById('remote-sdp-text');
const btnManualConnect = document.getElementById('btn-manual-connect');
const diagnosticLogs = document.getElementById('diagnostic-logs');
const btnCopyLocal = document.getElementById('btn-copy-local');
const qrcodeContainer = document.getElementById('qrcode-container');

// Initialize game
async function init() {
  try {
    logDiagnostic(`Initializing board. Role: ${isHost ? 'Host' : 'Client'}`);
    
    // UI configuration depending on Host/Client role
    if (!isHost) {
      // Set to manual mode by default for client
      if (btnModeManual) btnModeManual.classList.add('active');
      if (btnModeAuto) btnModeAuto.classList.remove('active');
      if (manualPanel) manualPanel.classList.remove('hidden');
      
      const manualColRight = document.getElementById('manual-col-right');
      if (manualColRight) manualColRight.style.display = 'none';
      
      const manualSplit = document.querySelector('.manual-split');
      if (manualSplit) manualSplit.style.gridTemplateColumns = '1fr';
      
      const leftTitle = document.getElementById('left-title');
      const leftDesc = document.getElementById('left-desc');
      if (leftTitle) leftTitle.textContent = "1. Your Answer Token";
      if (leftDesc) leftDesc.textContent = "Awaiting WebRTC answer generation...";
      if (btnManualOffer) btnManualOffer.classList.add('hidden');
      
      // Parse initial board grid from hash
      initialGrid = hashParams.grid || BASE_PUZZLES[0];
      currentGrid = initialGrid;
      window.sudokuInitialGrid = initialGrid;
      
      updateStatusBadge('active');
      renderBoard();
      logDiagnostic(`Client parsed grid and offer from URL. Ready to connect.`);
      return;
    }

    // Host Flow: Try loading from API first, fall back to local generation
    let loaded = false;
    try {
      const res = await fetch(`/api/sudoku/${gameId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          initialGrid = data.initial_grid;
          currentGrid = data.grid;
          updateStatusBadge(data.status);
          loaded = true;
        }
      }
    } catch (err) {
      console.log('Unable to reach server API, loading client-side instead.');
    }

    if (!loaded) {
      // Offline/static Host fallback
      initialGrid = hashParams.grid || BASE_PUZZLES[Math.floor(Math.random() * BASE_PUZZLES.length)];
      currentGrid = initialGrid;
      updateStatusBadge('active');
      
      // Update hash to keep state on refresh
      window.location.hash = `gameId=${gameId}&grid=${initialGrid}`;
    }

    window.sudokuInitialGrid = initialGrid;
    renderBoard();
    logDiagnostic(`Board loaded. Initial grid: ${initialGrid.substring(0, 10)}...`);
  } catch (err) {
    console.error('Error initializing board:', err);
    statusBadge.textContent = "Offline Error";
    logDiagnostic(`Initialization failed: ${err.message}`);
  }
}

// Render the 9x9 grid cells
function renderBoard() {
  const currentArray = currentGrid.split('').map(Number);
  const conflicts = getConflicts(currentArray);
  const cells = gridContainer.querySelectorAll('.cell');

  if (cells.length === 81) {
    // In-place updates to keep focus and cursor position
    for (let i = 0; i < 81; i++) {
      const cell = cells[i];
      const initialVal = initialGrid[i];
      const currentVal = currentGrid[i];

      if (initialVal === '0') {
        const input = cell.querySelector('input');
        if (input) {
          const expectedVal = currentVal === '0' ? '' : currentVal;
          if (document.activeElement !== input && input.value !== expectedVal) {
            input.value = expectedVal;
          }
        }
      }

      if (conflicts.has(i)) {
        cell.classList.add('conflict');
      } else {
        cell.classList.remove('conflict');
      }
    }
    return;
  }

  // Fallback: Full Board Reconstruction
  gridContainer.innerHTML = '';
  for (let i = 0; i < 81; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    
    const initialVal = initialGrid[i];
    const currentVal = currentGrid[i];
    
    if (initialVal !== '0') {
      cell.classList.add('initial');
      cell.textContent = initialVal;
    } else {
      cell.classList.add('user-filled');
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.pattern = '[1-9]';
      input.maxLength = 1;
      
      if (currentVal !== '0') {
        input.value = currentVal;
      }
      
      input.addEventListener('focus', () => {
        cell.classList.add('focused');
        window.dispatchEvent(new CustomEvent('sudoku:p2pSendFocus', {
          detail: { cellIndex: i }
        }));
      });
      input.addEventListener('blur', () => {
        cell.classList.remove('focused');
        window.dispatchEvent(new CustomEvent('sudoku:p2pSendFocus', {
          detail: { cellIndex: -1 }
        }));
      });
      
      input.addEventListener('input', (e) => {
        let val = e.target.value.replace(/[^1-9]/g, '');
        e.target.value = val;
        
        const numValue = val ? parseInt(val) : 0;
        playMove(i, numValue);
      });
      
      cell.appendChild(input);
    }
    
    if (conflicts.has(i)) {
      cell.classList.add('conflict');
    }
    
    gridContainer.appendChild(cell);
  }
}

// Coordinate game moves based on P2P roles
async function playMove(cellIndex, value) {
  if (!isHost) {
    // Client sends move request to Host over WebRTC
    logDiagnostic(`Requesting move from Host: Cell ${cellIndex} -> ${value}`);
    window.dispatchEvent(new CustomEvent('sudoku:p2pSendMove', {
      detail: { cellIndex, value }
    }));
    return;
  }

  // Host executes move directly
  await executeHostMove(cellIndex, value);
}

// Host authoritative move validation and execution
async function executeHostMove(cellIndex, value) {
  if (initialGrid[cellIndex] !== '0') {
    logDiagnostic(`[Host validation] Rejected: cell ${cellIndex} is static`);
    return;
  }

  // Update locally first for instantaneous feedback
  const gridArray = currentGrid.split('');
  gridArray[cellIndex] = String(value);
  const newGridStr = gridArray.join('');
  
  // Check if solved
  let status = 'active';
  const solvedArray = solveSudoku(initialGrid.split('').map(Number));
  if (solvedArray && newGridStr === solvedArray.join('')) {
    status = 'solved';
  }
  
  currentGrid = newGridStr;
  updateStatusBadge(status);
  renderBoard();

  logDiagnostic(`[Host validation] Local move applied Cell ${cellIndex} -> ${value}. Syncing...`);

  // Asynchronously try updating the server-side cache (if backend is running)
  try {
    fetch(`/api/sudoku/${gameId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellIndex, value })
    });
  } catch (err) {
    // Fail silently, operating serverless/static
  }

  // Broadcast update to all clients via WebRTC
  window.dispatchEvent(new CustomEvent('sudoku:p2pSendMove', {
    detail: { cellIndex, value, grid: currentGrid, status }
  }));
}

// Conflict checking algorithm (Row, Column, and 3x3 Box)
function getConflicts(grid) {
  const conflicts = new Set();
  
  // Rows
  for (let r = 0; r < 9; r++) {
    const seen = {};
    for (let c = 0; c < 9; c++) {
      const idx = r * 9 + c;
      const val = grid[idx];
      if (val !== 0) {
        if (seen[val] !== undefined) {
          conflicts.add(idx);
          conflicts.add(seen[val]);
        }
        seen[val] = idx;
      }
    }
  }
  
  // Columns
  for (let c = 0; c < 9; c++) {
    const seen = {};
    for (let r = 0; r < 9; r++) {
      const idx = r * 9 + c;
      const val = grid[idx];
      if (val !== 0) {
        if (seen[val] !== undefined) {
          conflicts.add(idx);
          conflicts.add(seen[val]);
        }
        seen[val] = idx;
      }
    }
  }
  
  // 3x3 boxes
  for (let b = 0; b < 9; b++) {
    const seen = {};
    const boxRow = Math.floor(b / 3) * 3;
    const boxCol = (b % 3) * 3;
    for (let i = 0; i < 3; i++) {
      const r = boxRow + i;
      for (let j = 0; j < 3; j++) {
        const c = boxCol + j;
        const idx = r * 9 + c;
        const val = grid[idx];
        if (val !== 0) {
          if (seen[val] !== undefined) {
            conflicts.add(idx);
            conflicts.add(seen[val]);
          }
          seen[val] = idx;
        }
      }
    }
  }
  
  return conflicts;
}

// Update status badge UI
function updateStatusBadge(status) {
  statusBadge.textContent = status;
  if (status === 'solved') {
    statusBadge.className = 'badge solved';
  } else {
    statusBadge.className = 'badge active';
  }
}

// Log message to diagnostic console box
function logDiagnostic(msg) {
  if (diagnosticLogs) {
    diagnosticLogs.textContent += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
    diagnosticLogs.scrollTop = diagnosticLogs.scrollHeight;
  }
}

/* Event Listeners for P2P Console Buttons */

// Toggle between Auto SSE and Manual Token mode
btnModeAuto.addEventListener('click', () => {
  btnModeAuto.classList.add('active');
  btnModeManual.classList.remove('active');
  modeDesc.textContent = "Uses the local node server to automatically exchange WebRTC coordinates. Perfect for standard setups.";
  manualPanel.classList.add('hidden');
  logDiagnostic("Switched signaling mode to: Auto (SSE).");
  window.dispatchEvent(new CustomEvent('sudoku:toggleP2PMode', { detail: { mode: 'auto' } }));
});

btnModeManual.addEventListener('click', () => {
  btnModeManual.classList.add('active');
  btnModeAuto.classList.remove('active');
  modeDesc.textContent = "Allows you to connect without any signaling server. Copy the offer token and send it to the other peer.";
  manualPanel.classList.remove('hidden');
  logDiagnostic("Switched signaling mode to: Manual (Token).");
  window.dispatchEvent(new CustomEvent('sudoku:toggleP2PMode', { detail: { mode: 'manual' } }));
});

// Generate local manual SDP offer
btnManualOffer.addEventListener('click', () => {
  logDiagnostic("Generating manual connection token...");
  window.dispatchEvent(new CustomEvent('sudoku:triggerManualOffer'));
});

// Submit pasted remote SDP token
btnManualConnect.addEventListener('click', () => {
  const token = remoteSdpText.value.trim();
  if (!token) {
    alert("Please paste a remote token first.");
    return;
  }
  logDiagnostic("Applying remote connection token...");
  window.dispatchEvent(new CustomEvent('sudoku:submitManualToken', { detail: { token } }));
});

/* P2P Engine Custom Event Receivers */

// Update diagnostic status panel
window.addEventListener('sudoku:p2pStatus', (e) => {
  const detail = e.detail;
  
  // Set badge text
  p2pStatusBadge.textContent = detail.status;
  p2pStatusBadge.className = `badge ${detail.status === 'connected' ? 'solved' : 'active'}`;

  // Update glowing status dot
  p2pIndicatorDot.className = 'indicator-dot';
  if (detail.status === 'connected') {
    p2pIndicatorDot.classList.add('green-glow');
  } else if (detail.status === 'connecting') {
    p2pIndicatorDot.classList.add('yellow-glow');
  } else if (detail.status === 'signaling') {
    p2pIndicatorDot.classList.add('blue-glow');
  } else {
    p2pIndicatorDot.classList.add('red-glow');
  }

  // Set Profile info
  profileNickname.textContent = detail.nickname;
  profileColor.style.backgroundColor = detail.color;
  profileRole.textContent = detail.isHost ? 'Host' : 'Client';

  // Network IPs list
  if (detail.hasIPv6) {
    networkTypeBadge.textContent = "IPv6 (Direct)";
    networkTypeBadge.style.background = "rgba(0, 255, 100, 0.15)";
    networkTypeBadge.style.color = "hsl(140, 80%, 65%)";
  } else if (detail.ips.length > 0) {
    networkTypeBadge.textContent = "IPv4 (STUN)";
    networkTypeBadge.style.background = "rgba(255, 170, 0, 0.1)";
    networkTypeBadge.style.color = "hsl(40, 95%, 60%)";
  } else {
    networkTypeBadge.textContent = "Local Host Only";
    networkTypeBadge.style.background = "rgba(255, 255, 255, 0.05)";
    networkTypeBadge.style.color = "var(--text-muted)";
  }

  if (detail.ips.length > 0) {
    discoveredIps.innerHTML = detail.ips.map(ip => `• ${ip}`).join('<br>');
  } else {
    discoveredIps.textContent = "Scanning local paths...";
  }

  if (detail.extra) {
    logDiagnostic(detail.extra);
  }
});

// Handle Host offer ready
window.addEventListener('sudoku:manualOfferReady', (e) => {
  localSdpText.value = e.detail.shareURL;
  if (btnCopyLocal) btnCopyLocal.classList.remove('hidden');
  if (qrcodeContainer) qrcodeContainer.classList.remove('hidden');
  
  const qrDiv = document.getElementById("qrcode");
  if (qrDiv) {
    qrDiv.innerHTML = "";
    if (typeof QRCode !== 'undefined') {
      try {
        new QRCode(qrDiv, {
          text: e.detail.shareURL,
          width: 160,
          height: 160,
          colorDark : "#000000",
          colorLight : "#ffffff",
          correctLevel : QRCode.CorrectLevel.M
        });
      } catch (qrErr) {
        console.error("Error creating QR Code:", qrErr);
      }
    } else {
      logDiagnostic("⚠️ QRCode script not loaded. Verify internet connection.");
    }
  }
  
  const leftTitle = document.getElementById('left-title');
  const leftDesc = document.getElementById('left-desc');
  if (leftTitle) leftTitle.textContent = "1. Your Shareable Link";
  if (leftDesc) leftDesc.textContent = "Copy the link below and send it to the client player.";
  
  logDiagnostic("Shareable URL generated! Copy it or scan the QR code to connect.");
  
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    logDiagnostic("💡 Tip: Since the server is on localhost, your mobile phone on a different network cannot resolve this link directly. To play from a mobile phone, run a public tunnel (like ngrok) or host these files on GitHub Pages!");
  }
});

// Handle Client answer ready
window.addEventListener('sudoku:manualAnswerReady', (e) => {
  localSdpText.value = e.detail.token;
  if (btnCopyLocal) btnCopyLocal.classList.remove('hidden');
  if (qrcodeContainer) qrcodeContainer.classList.add('hidden');
  
  const leftTitle = document.getElementById('left-title');
  const leftDesc = document.getElementById('left-desc');
  if (leftTitle) leftTitle.textContent = "1. Your Answer Token";
  if (leftDesc) leftDesc.textContent = "Copy the token below and send it back to the Host.";
  
  logDiagnostic("Answer token generated! Send this token back to the Host to complete connection.");
});

// Sync state on Client connect
window.addEventListener('sudoku:syncState', (e) => {
  initialGrid = e.detail.initialGrid;
  currentGrid = e.detail.currentGrid;
  updateStatusBadge(e.detail.status);
  renderBoard();
  logDiagnostic("Synchronized grid state from Host.");
});

// Host responds to client sync requests
window.addEventListener('sudoku:requestStateSync', (e) => {
  const recipientId = e.detail.recipientId;
  logDiagnostic(`Syncing current grid state to new peer: ${recipientId}`);
  window.dispatchEvent(new CustomEvent('sudoku:p2pSyncRequested', {
    detail: {
      recipientId,
      initialGrid,
      currentGrid,
      status: statusBadge.textContent
    }
  }));
});

// Host processes move verification requests from Client
window.addEventListener('sudoku:localMove', (e) => {
  const { cellIndex, value, isExternal, senderId } = e.detail;
  if (isHost && isExternal) {
    logDiagnostic(`P2P Host validated client move: Cell ${cellIndex} -> ${value}`);
    executeHostMove(cellIndex, value);
  }
});

// Host processes solve requests from Client
window.addEventListener('sudoku:localSolve', async (e) => {
  if (isHost) {
    logDiagnostic(`P2P Host processing solve request from client: ${e.detail.senderId}`);
    
    const solvedArray = solveSudoku(initialGrid.split('').map(Number));
    if (solvedArray) {
      currentGrid = solvedArray.join('');
      const status = 'solved';
      updateStatusBadge(status);
      renderBoard();
      
      // Asynchronously update backend
      try {
        fetch(`/api/sudoku/${gameId}/solve`, { method: 'POST' });
      } catch (err) {}

      // Broadcast solve event
      window.dispatchEvent(new CustomEvent('sudoku:p2pSendSolve', {
        detail: { grid: currentGrid, status }
      }));
    }
  }
});

// Sync external movements (Client updates or peer moves broadcasted by Host)
window.addEventListener('sudoku:externalMove', (e) => {
  currentGrid = e.detail.grid;
  updateStatusBadge(e.detail.status);
  renderBoard();
  logDiagnostic("Peer played a move.");
});

// Sync external solve triggers
window.addEventListener('sudoku:externalSolve', (e) => {
  currentGrid = e.detail.grid;
  updateStatusBadge(e.detail.status);
  renderBoard();
  logDiagnostic("Board solved by Host.");
});

// Focus updates
window.addEventListener('sudoku:externalFocus', (e) => {
  // Pass to coop renderer in inject.js which handles drawing borders and username tags
});

/* Controls Panel Button Click Listeners */

btnReset.addEventListener('click', async () => {
  if (!isHost) {
    logDiagnostic("Reset request sent to Host.");
  }
  // Clear all non-initial values locally (for host it will write, for client it will send moves)
  for (let i = 0; i < 81; i++) {
    if (initialGrid[i] === '0' && currentGrid[i] !== '0') {
      await playMove(i, 0);
    }
  }
  logDiagnostic("Reset completed.");
});

btnSolve.addEventListener('click', async () => {
  if (!isHost) {
    // Client requests solve from Host
    logDiagnostic("Requesting Host to solve game board...");
    window.dispatchEvent(new CustomEvent('sudoku:p2pSendSolve', { detail: {} }));
    return;
  }

  // Host solves locally
  statusBadge.textContent = "Solving...";
  const solvedArray = solveSudoku(initialGrid.split('').map(Number));
  if (solvedArray) {
    currentGrid = solvedArray.join('');
    const status = 'solved';
    updateStatusBadge(status);
    renderBoard();
    logDiagnostic("Game solved.");

    // Asynchronously try updating the server-side cache (if backend is running)
    try {
      fetch(`/api/sudoku/${gameId}/solve`, { method: 'POST' });
    } catch (err) {
      // Fail silently
    }

    // Broadcast solve event
    window.dispatchEvent(new CustomEvent('sudoku:p2pSendSolve', {
      detail: { grid: currentGrid, status }
    }));
  }
});

btnNew.addEventListener('click', async () => {
  logDiagnostic("Generating a new board...");
  
  // Try calling backend API first (if it exists)
  try {
    const res = await fetch('/api/sudoku', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        window.location.href = `/sudoku/${data.id}?role=host`;
        return;
      }
    }
  } catch (err) {
    console.log("Offline or static host, generating puzzle client-side.");
  }
  
  // Local fallback: generate new gameId and new puzzle, update hash, reload page
  const newGameId = 'game_' + Math.random().toString(36).substring(2, 9);
  const newPuzzle = BASE_PUZZLES[Math.floor(Math.random() * BASE_PUZZLES.length)];
  
  window.location.hash = `#gameId=${newGameId}&grid=${newPuzzle}`;
  window.location.reload();
});

// Copy to clipboard listener for local SDP offer/answer text box
if (btnCopyLocal) {
  btnCopyLocal.addEventListener('click', async () => {
    const textToCopy = localSdpText.value;
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      const originalText = btnCopyLocal.textContent;
      btnCopyLocal.textContent = "Copied!";
      btnCopyLocal.style.background = "hsl(140, 80%, 65%)";
      btnCopyLocal.style.color = "#000";
      setTimeout(() => {
        btnCopyLocal.textContent = originalText;
        btnCopyLocal.style.background = "";
        btnCopyLocal.style.color = "";
      }, 2000);
      logDiagnostic("Copied token/link to clipboard.");
    } catch (err) {
      console.error("Failed to copy text:", err);
      alert("Failed to copy. Please manually select the text box and copy it.");
    }
  });
}

// Run init
init();
