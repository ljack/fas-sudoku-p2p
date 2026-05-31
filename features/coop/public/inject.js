(function() {
  console.log('[FAS Plugin] Injecting Live Co-Op Multiplayer feature...');

  const gameId = window.location.pathname.split('/').pop();
  
  // 1. Generate local player metadata
  const playerId = 'player_' + Math.random().toString(36).substring(2, 9);
  const colorList = [
    'hsl(140, 80%, 65%)', // Green
    'hsl(330, 85%, 70%)', // Pink
    'hsl(40, 95%, 60%)',  // Orange
    'hsl(200, 90%, 65%)', // Sky Blue
    'hsl(270, 90%, 70%)'  // Purple
  ];
  const myColor = colorList[Math.floor(Math.random() * colorList.length)];
  const nameList = ['Astro Solver', 'Cosmic Solver', 'Star Solv', 'Nebula Brain', 'Gravity Zero', 'Galaxy Brain'];
  const myNickname = nameList[Math.floor(Math.random() * nameList.length)] + ' #' + Math.floor(Math.random() * 900 + 100);

  console.log(`[Co-Op] Registered as: ${myNickname} (${playerId}) with color ${myColor}`);

  let eventSource = null;

  // 2. Establish Server-Sent Events stream
  function connectStream() {
    eventSource = new EventSource(`/api/sudoku/${gameId}/coop-stream?playerId=${playerId}&nickname=${encodeURIComponent(myNickname)}&t=${Date.now()}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'move':
            console.log('[Co-Op] Received external move update');
            // Dispatch dynamic window event to sync parent grid
            window.dispatchEvent(new CustomEvent('sudoku:externalMove', {
              detail: { grid: data.grid, status: data.status }
            }));
            break;

          case 'solve':
            console.log('[Co-Op] Received external solve trigger');
            window.dispatchEvent(new CustomEvent('sudoku:externalSolve', {
              detail: { grid: data.grid, status: data.status }
            }));
            break;

          case 'focus':
            if (data.playerId !== playerId) {
              handlePeerFocus(data);
            }
            break;

          case 'presence':
            renderPresencePanel(data.players);
            break;
            
          default:
            break;
        }
      } catch (err) {
        console.error('[Co-Op] Error parsing SSE payload:', err);
      }
    };

    eventSource.onerror = (e) => {
      console.warn('[Co-Op] Stream disconnected, attempting reconnect...', e);
      eventSource.close();
      setTimeout(connectStream, 3000);
    };
  }

  // Render active players and their idle timeouts
  function renderPresencePanel(players) {
    let panel = document.getElementById('presence-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'presence-panel';
      panel.className = 'presence-panel';
      const appCard = document.querySelector('.app-card');
      const sudokuGrid = document.getElementById('sudoku-grid');
      if (appCard && sudokuGrid) {
        appCard.insertBefore(panel, sudokuGrid);
      }
    }

    panel.innerHTML = '';
    
    const countSpan = document.createElement('span');
    countSpan.className = 'presence-count';
    countSpan.textContent = `👥 ${players.length} player${players.length > 1 ? 's' : ''} online`;
    panel.appendChild(countSpan);

    const listDiv = document.createElement('div');
    listDiv.className = 'presence-list';

    players.forEach(p => {
      const badge = document.createElement('span');
      badge.className = 'presence-badge';
      
      let text = p.nickname;
      if (p.playerId === playerId) {
        text += ' (you)';
        badge.classList.add('self');
      }

      if (p.idleSeconds > 10) {
        badge.classList.add('idle');
        badge.textContent = `${text} (idle ${p.idleSeconds}s)`;
      } else {
        badge.textContent = `${text} (active)`;
      }

      listDiv.appendChild(badge);
    });

    panel.appendChild(listDiv);
  }

  // 3. Render peer focus outlines and name tags
  function handlePeerFocus(data) {
    // Remove any existing outlines/tags for this player
    document.querySelectorAll(`.peer-highlight-${data.playerId}`).forEach(el => el.remove());
    
    if (data.cellIndex === -1) {
      return; // Player blurred / left cell
    }

    const cells = document.querySelectorAll('#sudoku-grid .cell');
    const targetCell = cells[data.cellIndex];
    if (targetCell) {
      // Create glowing border highlight
      const outline = document.createElement('div');
      outline.className = `peer-focus-outline peer-highlight-${data.playerId}`;
      outline.style.borderColor = data.color;
      outline.style.boxShadow = `0 0 8px ${data.color}`;
      
      // Create name tag bubble
      const tag = document.createElement('span');
      tag.className = `peer-focus-tag peer-highlight-${data.playerId}`;
      tag.style.backgroundColor = data.color;
      tag.textContent = data.nickname;
      
      outline.appendChild(tag);
      targetCell.appendChild(outline);
    }
  }

  // 4. Capture input focus changes using event delegation on the grid container
  function setupInputDelegation() {
    const gridContainer = document.getElementById('sudoku-grid');
    if (!gridContainer) {
      setTimeout(setupInputDelegation, 100);
      return;
    }

    // Helper to find input index
    function getCellIndex(inputElement) {
      const cell = inputElement.closest('.cell');
      const cells = Array.from(document.querySelectorAll('#sudoku-grid .cell'));
      return cells.indexOf(cell);
    }

    // Input Focus Listener
    gridContainer.addEventListener('focusin', (e) => {
      if (e.target.tagName === 'INPUT') {
        const cellIndex = getCellIndex(e.target);
        if (cellIndex !== -1) {
          sendFocusUpdate(cellIndex);
        }
      }
    });

    // Input Blur Listener
    gridContainer.addEventListener('focusout', (e) => {
      if (e.target.tagName === 'INPUT') {
        sendFocusUpdate(-1); // -1 represents blur state
      }
    });
  }

  // Post focus state to backend
  async function sendFocusUpdate(cellIndex) {
    try {
      await fetch(`/api/sudoku/${gameId}/focus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cellIndex,
          playerId,
          color: myColor,
          nickname: myNickname
        })
      });
    } catch (e) {
      console.warn('[Co-Op] Failed to sync focus state:', e.message);
    }
  }

  // Heartbeat to keep connection alive and update activity timestamp
  function startHeartbeat() {
    setInterval(() => {
      sendFocusUpdate(-2); // Special value -2 indicates heartbeat / keep-active
    }, 10000);
  }

  // Boot
  connectStream();
  setupInputDelegation();
  startHeartbeat();
})();
