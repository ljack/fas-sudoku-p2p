const gameId = window.location.pathname.split('/').pop();
document.getElementById('game-id').textContent = gameId;

let initialGrid = "";
let currentGrid = "";

// Select DOM elements
const gridContainer = document.getElementById('sudoku-grid');
const statusBadge = document.getElementById('game-status');
const btnReset = document.getElementById('btn-reset');
const btnNew = document.getElementById('btn-new');
const btnSolve = document.getElementById('btn-solve');

// Initialize game
async function init() {
  try {
    const res = await fetch(`/api/sudoku/${gameId}`);
    const data = await res.json();
    
    if (!data.success) {
      statusBadge.textContent = "Error loading";
      statusBadge.className = "badge conflict";
      return;
    }
    
    initialGrid = data.initial_grid;
    currentGrid = data.grid;
    
    updateStatusBadge(data.status);
    renderBoard();
  } catch (err) {
    console.error('Error fetching game state:', err);
    statusBadge.textContent = "Offline";
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
      // Locked initial puzzle cell
      cell.classList.add('initial');
      cell.textContent = initialVal;
    } else {
      // Editable user input cell
      cell.classList.add('user-filled');
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.pattern = '[1-9]';
      input.maxLength = 1;
      
      if (currentVal !== '0') {
        input.value = currentVal;
      }
      
      // Focus styling
      input.addEventListener('focus', () => cell.classList.add('focused'));
      input.addEventListener('blur', () => cell.classList.remove('focused'));
      
      // On value change, validate and sync
      input.addEventListener('input', (e) => {
        let val = e.target.value.replace(/[^1-9]/g, '');
        e.target.value = val; // Force numeric 1-9
        
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

// Sync move to the server
async function playMove(cellIndex, value) {
  try {
    const res = await fetch(`/api/sudoku/${gameId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellIndex, value })
    });
    
    const data = await res.json();
    if (data.success) {
      currentGrid = data.grid;
      updateStatusBadge(data.status);
      
      // Re-render board to check dynamic conflicts
      renderBoard();
    }
  } catch (err) {
    console.error('Error playing move:', err);
  }
}

// Conflict checking algorithm (Row, Column, and 3x3 Box)
function getConflicts(grid) {
  const conflicts = new Set();
  
  // 1. Check rows
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
  
  // 2. Check columns
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
  
  // 3. Check 3x3 boxes
  for (let b = 0; b < 9; b++) {
    const seen = {};
    const boxRow = Math.floor(b / 3) * 3;
    const boxCol = (b % 3) * 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const r = boxRow + i;
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

// Update the badge UI state
function updateStatusBadge(status) {
  statusBadge.textContent = status;
  if (status === 'solved') {
    statusBadge.className = 'badge solved';
  } else {
    statusBadge.className = 'badge active';
  }
}

// Event Listeners for buttons
btnReset.addEventListener('click', async () => {
  // Clear all non-initial values locally and update database
  for (let i = 0; i < 81; i++) {
    if (initialGrid[i] === '0' && currentGrid[i] !== '0') {
      await playMove(i, 0);
    }
  }
});

btnSolve.addEventListener('click', async () => {
  try {
    statusBadge.textContent = "Solving...";
    const res = await fetch(`/api/sudoku/${gameId}/solve`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      currentGrid = data.grid;
      updateStatusBadge(data.status);
      renderBoard();
    }
  } catch (err) {
    console.error('Error auto-solving:', err);
  }
});

btnNew.addEventListener('click', () => {
  // Navigate to standard /sudoku endpoint to create a new game and get redirected
  window.location.href = '/sudoku';
});

// Run
init();

// Listen for external sync events from plugins (Co-Op)
window.addEventListener('sudoku:externalMove', (e) => {
  const { grid, status } = e.detail;
  currentGrid = grid;
  updateStatusBadge(status);
  renderBoard();
});

window.addEventListener('sudoku:externalSolve', (e) => {
  const { grid, status } = e.detail;
  currentGrid = grid;
  updateStatusBadge(status);
  renderBoard();
});
