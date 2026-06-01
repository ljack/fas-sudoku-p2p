// Parse URL hash to extract game variables
const isCompressionSupported = typeof window.CompressionStream !== 'undefined' && typeof window.DecompressionStream !== 'undefined';

async function decompressText(bytes) {
  if (!isCompressionSupported) return '';
  const stream = new Blob([bytes]).stream();
  const decompressedStream = stream.pipeThrough(new DecompressionStream('deflate'));
  return await new Response(decompressedStream).text();
}

function base64UrlToUint8Array(base64Url) {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getHashParams() {
  const hash = window.location.hash.substring(1);
  if (!hash) return {};

  if (hash.startsWith('j_')) {
    try {
      const token = hash.substring(2);
      const bytes = base64UrlToUint8Array(token);
      const decompressed = await decompressText(bytes);
      const inviteData = JSON.parse(decompressed);
      
      // Convert to legacy structure for seamless backward compatibility
      return {
        gameId: inviteData.gameId,
        grid: inviteData.grid,
        offer: btoa(JSON.stringify(inviteData.offer)),
        proxyPeerId: inviteData.proxyPeerId
      };
    } catch (err) {
      console.error('[P2P Setup] Failed to decompress token from hash:', err);
      return {};
    }
  }

  // Legacy fallback parsing
  const params = {};
  hash.split('&').forEach(pair => {
    const [key, val] = pair.split('=');
    if (key && val) {
      params[key] = decodeURIComponent(val);
    }
  });
  return params;
}

let hashParams = {};
let hasOfferInHash = false;
let isHost = true;
let gameId = '';

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
    hashParams = await getHashParams();
    hasOfferInHash = !!hashParams.offer;
    isHost = !hasOfferInHash;
    
    // Extract gameId
    gameId = hashParams.gameId;
    if (!gameId) {
      const pathParts = window.location.pathname.split('/').filter(Boolean);
      const lastPart = pathParts.pop();
      if (lastPart && lastPart.startsWith('game_')) {
        gameId = lastPart;
      }
    }
    if (!gameId) {
      gameId = 'game_' + Math.random().toString(36).substring(2, 9);
    }
    
    const gameIdEl = document.getElementById('game-id');
    if (gameIdEl) gameIdEl.textContent = gameId;

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
    }).catch(() => {});
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
let p2pActiveSlotId = null;
const slotTokens = {};

function renderSlotQRCode(text) {
  const qrDiv = document.getElementById("qrcode");
  if (qrDiv) {
    qrDiv.innerHTML = "";
    if (typeof QRCode !== 'undefined') {
      try {
        new QRCode(qrDiv, {
          text: text,
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
      console.log("⚠️ QRCode script not loaded.");
    }
  }
}

function refreshActiveSlotUI() {
  const sid = p2pActiveSlotId || 'slot_1';
  const tokens = slotTokens[sid] || { local: '', remote: '' };
  console.log(`[E2E Debug APP] refreshActiveSlotUI: activeSlotId=${p2pActiveSlotId}, sid=${sid}, tokens=`, tokens);
  
  localSdpText.value = tokens.local || '';
  remoteSdpText.value = tokens.remote || '';

  if (tokens.local) {
    if (btnCopyLocal) btnCopyLocal.classList.remove('hidden');
    if (tokens.local.startsWith('http') || tokens.local.includes('#gameId=')) {
      if (qrcodeContainer) qrcodeContainer.classList.remove('hidden');
      setTimeout(() => {
        renderSlotQRCode(tokens.local);
      }, 50);
    } else {
      if (qrcodeContainer) qrcodeContainer.classList.add('hidden');
    }
  } else {
    if (btnCopyLocal) btnCopyLocal.classList.add('hidden');
    if (qrcodeContainer) qrcodeContainer.classList.add('hidden');
  }

  const leftTitle = document.getElementById('left-title');
  const leftDesc = document.getElementById('left-desc');
  const rightTitle = document.getElementById('right-title');
  const rightDesc = document.getElementById('right-desc');

  if (isHost) {
    if (leftTitle) leftTitle.textContent = "1. Invite Link for " + (sid.startsWith('auto_') ? 'Auto Backup' : sid.toUpperCase());
    if (leftDesc) leftDesc.textContent = "Click 'Generate Token' to create a link for this peer slot.";
    
    if (rightTitle) rightTitle.textContent = "2. Paste Answer from " + (sid.startsWith('auto_') ? 'Auto Backup' : sid.toUpperCase());
    if (rightDesc) rightDesc.textContent = "Paste the answer token from the joining client below.";
  } else {
    if (sid === 'parent_slot') {
      if (leftTitle) leftTitle.textContent = "1. Host Answer Token";
      if (leftDesc) leftDesc.textContent = "Provide this token back to the Host browser to complete manual pairing.";
      
      if (rightTitle) rightTitle.textContent = "2. Host Remote Offer";
      if (rightDesc) rightDesc.textContent = "Your client loads the offer parameters automatically from the link hash.";
    } else {
      if (leftTitle) leftTitle.textContent = "1. Proxy Invite Link for " + sid.toUpperCase();
      if (leftDesc) leftDesc.textContent = "Click 'Generate Token' and share this link with the child player.";
      
      if (rightTitle) rightTitle.textContent = "2. Paste Answer for " + sid.toUpperCase();
      if (rightDesc) rightDesc.textContent = "Paste the answer token generated by the child client below.";
    }
  }
}

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
  const sid = p2pActiveSlotId || 'slot_1';
  logDiagnostic(`Generating manual connection token for slot ${sid}...`);
  window.dispatchEvent(new CustomEvent('sudoku:triggerManualOffer', { detail: { slotId: sid } }));
});

// Submit pasted remote SDP token
btnManualConnect.addEventListener('click', () => {
  const token = remoteSdpText.value.trim();
  if (!token) {
    alert("Please paste a remote token first.");
    return;
  }
  const sid = p2pActiveSlotId || 'slot_1';
  logDiagnostic(`Applying remote connection token to slot ${sid}...`);
  
  if (!slotTokens[sid]) slotTokens[sid] = { local: '', remote: '' };
  slotTokens[sid].remote = token;
  
  window.dispatchEvent(new CustomEvent('sudoku:submitManualToken', { detail: { token, slotId: sid } }));
});

/* P2P Engine Custom Event Receivers */

// Update diagnostic status panel and tabs
window.addEventListener('sudoku:p2pStatus', (e) => {
  const detail = e.detail;
  console.log('[E2E Debug APP] received sudoku:p2pStatus event status:', detail.status, 'detail:', detail);
  
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

  // Lobby Presence Roster Rendering
  const lobbyRoster = document.getElementById('p2p-lobby-roster');
  const rosterTitle = document.getElementById('lobby-roster-title');
  if (lobbyRoster && rosterTitle) {
    if (detail.players && detail.players.length > 1) {
      rosterTitle.style.display = 'block';
      lobbyRoster.style.display = 'flex';
      lobbyRoster.innerHTML = detail.players.map(player => {
        const isSelf = player.playerId === detail.peerId;
        const roleLabel = player.isHost ? 'Host' : (player.proxyId ? `Relay (via ${player.proxyId === 'host' ? 'Host' : player.proxyId.substring(0, 8)})` : 'Direct');
        return `
          <div class="lobby-player-row" style="display: flex; align-items: center; gap: 8px; font-size: 0.75rem; background: rgba(255,255,255,0.02); padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.04);">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${player.color}; display: inline-block;"></span>
            <span style="font-weight: 600; color: ${isSelf ? 'var(--accent-cyan)' : 'var(--text-main)'};">${player.nickname} ${isSelf ? '(You)' : ''}</span>
            <span style="font-size: 0.6rem; padding: 1px 4px; border-radius: 4px; background: rgba(255,255,255,0.08); margin-left: auto; color: var(--text-muted); text-transform: uppercase;">${roleLabel}</span>
          </div>
        `;
      }).join('');
    } else {
      rosterTitle.style.display = 'none';
      lobbyRoster.style.display = 'none';
    }
  }

  // Slots Bar Tab Rendering
  const slotsBarContainer = document.getElementById('p2p-slots-bar-container');
  const slotsBar = document.getElementById('p2p-slots-bar');
  if (slotsBarContainer && slotsBar && detail.slots) {
    slotsBarContainer.style.display = 'flex';
    const slotIds = Object.keys(detail.slots);
    
    if (!p2pActiveSlotId || !detail.slots[p2pActiveSlotId]) {
      p2pActiveSlotId = detail.isHost ? (slotIds[0] || 'slot_1') : 'parent_slot';
    }

    let tabsHTML = '';
    
    if (detail.isHost) {
      tabsHTML = slotIds.map(sid => {
        const slot = detail.slots[sid];
        const isActive = sid === p2pActiveSlotId;
        
        let statusLabel = sid.toUpperCase();
        let badgeColor = 'hsl(0, 0%, 50%)'; // Idle grey
        if (slot.status === 'connected') {
          statusLabel = slot.nickname ? slot.nickname.substring(0, 10) : 'Connected';
          badgeColor = 'hsl(140, 80%, 65%)'; // Connected green
        } else if (slot.status === 'gathering' || slot.status === 'handshaking') {
          statusLabel = 'Inviting';
          badgeColor = 'hsl(40, 95%, 60%)'; // Gathering yellow
        }

        return `
          <button class="slot-tab ${isActive ? 'active' : ''}" data-slot-id="${sid}" style="border: 1px solid ${isActive ? 'var(--accent-cyan)' : 'var(--glass-border)'}; background: ${isActive ? 'rgba(0, 240, 255, 0.1)' : 'rgba(0,0,0,0.2)'}; color: ${isActive ? '#fff' : 'var(--text-muted)'}; font-size: 0.7rem; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 5px; outline: none; margin-bottom: 5px;">
            <span style="width: 5px; height: 5px; border-radius: 50%; background: ${badgeColor}; display: inline-block;"></span>
            ${slot.isAuto ? 'Auto: ' : ''}${statusLabel}
          </button>
        `;
      }).join('');

      tabsHTML += `
        <button id="btn-add-slot" style="border: 1px dashed var(--glass-border); background: transparent; color: var(--text-muted); font-size: 0.7rem; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 4px; outline: none; margin-bottom: 5px;">
          + Add Slot
        </button>
      `;
    } else {
      const proxySlotIds = slotIds.filter(id => id !== 'parent_slot' && !id.startsWith('auto_'));
      
      tabsHTML = `
        <button class="slot-tab ${p2pActiveSlotId === 'parent_slot' ? 'active' : ''}" data-slot-id="parent_slot" style="border: 1px solid ${p2pActiveSlotId === 'parent_slot' ? 'var(--accent-cyan)' : 'var(--glass-border)'}; background: ${p2pActiveSlotId === 'parent_slot' ? 'rgba(0, 240, 255, 0.1)' : 'rgba(0,0,0,0.2)'}; color: ${p2pActiveSlotId === 'parent_slot' ? '#fff' : 'var(--text-muted)'}; font-size: 0.7rem; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 5px; outline: none; margin-bottom: 5px;">
          <span style="width: 5px; height: 5px; border-radius: 50%; background: ${detail.status === 'connected' ? 'hsl(140, 80%, 65%)' : 'hsl(40, 95%, 60%)'}; display: inline-block;"></span>
          Host Link
        </button>
      `;

      proxySlotIds.forEach(sid => {
        const slot = detail.slots[sid];
        const isActive = sid === p2pActiveSlotId;
        
        let statusLabel = 'Relay Link';
        let badgeColor = 'hsl(0, 0%, 50%)'; // Idle grey
        if (slot.status === 'connected') {
          statusLabel = slot.nickname ? `Relay: ${slot.nickname.substring(0, 10)}` : 'Relayed';
          badgeColor = 'hsl(140, 80%, 65%)'; // Connected green
        } else if (slot.status === 'gathering' || slot.status === 'handshaking') {
          statusLabel = 'Relay Invite';
          badgeColor = 'hsl(40, 95%, 60%)'; // Gathering yellow
        }

        tabsHTML += `
          <button class="slot-tab ${isActive ? 'active' : ''}" data-slot-id="${sid}" style="border: 1px solid ${isActive ? 'var(--accent-cyan)' : 'var(--glass-border)'}; background: ${isActive ? 'rgba(0, 240, 255, 0.1)' : 'rgba(0,0,0,0.2)'}; color: ${isActive ? '#fff' : 'var(--text-muted)'}; font-size: 0.7rem; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 5px; outline: none; margin-bottom: 5px;">
            <span style="width: 5px; height: 5px; border-radius: 50%; background: ${badgeColor}; display: inline-block;"></span>
            ${statusLabel}
          </button>
        `;
      });

      tabsHTML += `
        <button id="btn-add-proxy-slot" style="border: 1px dashed var(--glass-border); background: transparent; color: var(--text-muted); font-size: 0.7rem; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 4px; outline: none; margin-bottom: 5px;">
          + Relay Slot
        </button>
      `;
    }

    slotsBar.innerHTML = tabsHTML;

    // Attach click listeners to slot buttons
    slotsBar.querySelectorAll('.slot-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        p2pActiveSlotId = btn.getAttribute('data-slot-id');
        refreshActiveSlotUI();
        window.dispatchEvent(new CustomEvent('sudoku:p2pStatus', { detail }));
      });
    });

    const btnAddSlot = document.getElementById('btn-add-slot');
    if (btnAddSlot) {
      btnAddSlot.addEventListener('click', () => {
        const nextId = 'slot_' + (slotIds.filter(id => !id.startsWith('auto_')).length + 1);
        p2pActiveSlotId = nextId;
        window.dispatchEvent(new CustomEvent('sudoku:triggerManualOffer', { detail: { slotId: nextId } }));
      });
    }

    const btnAddProxySlot = document.getElementById('btn-add-proxy-slot');
    if (btnAddProxySlot) {
      btnAddProxySlot.addEventListener('click', () => {
        const currentProxyCount = Object.keys(detail.slots).filter(id => id.startsWith('proxy_slot_')).length;
        const nextId = 'proxy_slot_' + (currentProxyCount + 1);
        p2pActiveSlotId = nextId;
        window.dispatchEvent(new CustomEvent('sudoku:triggerManualOffer', { detail: { slotId: nextId } }));
      });
    }
  }

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
  const { slotId, shareURL } = e.detail;
  console.log(`[E2E Debug APP] manualOfferReady event: slotId=${slotId}, activeSlotId=${p2pActiveSlotId}, urlLength=${shareURL ? shareURL.length : 0}`);
  if (!slotTokens[slotId]) slotTokens[slotId] = { local: '', remote: '' };
  slotTokens[slotId].local = shareURL;

  if (slotId === p2pActiveSlotId) {
    refreshActiveSlotUI();
    logDiagnostic(`Shareable URL generated for slot ${slotId}! Copy it or scan the QR code to connect.`);
  }
});

// Handle Client answer ready
window.addEventListener('sudoku:manualAnswerReady', (e) => {
  const { slotId, token } = e.detail;
  console.log(`[E2E Debug APP] manualAnswerReady event: slotId=${slotId}, activeSlotId=${p2pActiveSlotId}, tokenLength=${token ? token.length : 0}`);
  if (!slotTokens[slotId]) slotTokens[slotId] = { local: '', remote: '' };
  slotTokens[slotId].local = token;

  if (slotId === p2pActiveSlotId) {
    refreshActiveSlotUI();
    logDiagnostic(`Answer token generated for slot ${slotId}! Send this token back to the Host.`);
  }
});

// Sync state on Client connect
window.addEventListener('sudoku:syncState', (e) => {
  console.log('[E2E Debug APP] syncState received initialGrid:', e.detail.initialGrid, 'currentGrid:', e.detail.currentGrid);
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
        fetch(`/api/sudoku/${gameId}/solve`, { method: 'POST' }).catch(() => {});
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
      fetch(`/api/sudoku/${gameId}/solve`, { method: 'POST' }).catch(() => {});
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
