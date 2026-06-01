import express from 'express';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { FeatureModule, FeatureContext } from '../../core/registry';

// Standard backtracking Sudoku solver
function solveSudoku(grid: number[]): number[] | null {
  const board = [...grid];
  if (solveHelper(board)) {
    return board;
  }
  return null;
}

function solveHelper(board: number[]): boolean {
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

function isValid(board: number[], idx: number, val: number): boolean {
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

export const sudokuFeature: FeatureModule = {
  name: 'sudoku',

  onBoot: async (context: FeatureContext) => {
    console.log('[Sudoku] Running database migration setup...');

    // 1. Database Table Schema Setup
    context.db.registerMigration('sudoku', `
      CREATE TABLE IF NOT EXISTS sudoku_games (
        id VARCHAR(50) PRIMARY KEY,
        grid VARCHAR(81) NOT NULL,
        initial_grid VARCHAR(81) NOT NULL,
        solution VARCHAR(81) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Serve public client folder statically
    const publicPath = path.join(__dirname, 'public');
    context.router.use('/sudoku-client', express.static(publicPath));

    // 3. Game page route - Redirect base /sudoku to a new game
    context.router.get('/sudoku', async (req, res) => {
      const gameId = crypto.randomUUID();
      const randomPuzzle = BASE_PUZZLES[Math.floor(Math.random() * BASE_PUZZLES.length)];
      const gridArray = randomPuzzle.split('').map(Number);
      const solvedArray = solveSudoku(gridArray);
      
      if (!solvedArray) {
        return res.status(500).send("Failed to generate solvable sudoku puzzle.");
      }
      
      const solutionStr = solvedArray.join('');

      try {
        await context.db.query(
          `INSERT INTO sudoku_games (id, grid, initial_grid, solution, status) 
           VALUES ($1, $2, $3, $4, $5)`,
          [gameId, randomPuzzle, randomPuzzle, solutionStr, 'active']
        );
        res.redirect(`/sudoku/${gameId}?role=host`);
      } catch (err: any) {
        console.error('[Sudoku] Create failed on redirect:', err.message);
        res.status(500).send("Database initialization error.");
      }
    });

    // 4. RESTful URL points to a specific game board
    context.router.get('/sudoku/:id', (req, res) => {
      fs.readFile(path.join(publicPath, 'index.html'), 'utf8', (err, html) => {
        if (err) {
          return res.status(500).send("HTML template load error.");
        }
        
        let injectStr = '';
        
        // Dynamically inject leaderboard resources if enabled
        try {
          const configJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf8'));
          if (configJson.features && configJson.features.leaderboard === true) {
            injectStr += `
  <link rel="stylesheet" href="/leaderboard-client/inject.css">
  <script src="/leaderboard-client/inject.js" defer></script>
            `;
          }
          if (configJson.features && configJson.features.coop === true) {
            injectStr += `
  <link rel="stylesheet" href="/coop-client/inject.css">
  <script src="/coop-client/inject.js" defer></script>
            `;
          }
        } catch (e) {
          console.warn('[Sudoku] Warning reading features config for injections:', e);
        }
        
        const finalHtml = html.replace('<!-- FAS_INJECT -->', injectStr);
        res.send(finalHtml);
      });
    });

    // 5. REST API: Fetch current status
    context.router.get('/api/sudoku/:id', async (req, res) => {
      const gameId = req.params.id;
      try {
        const result = await context.db.query('SELECT id, grid, initial_grid, status FROM sudoku_games WHERE id = $1', [gameId]);
        if (result.rowCount === 0) {
          return res.status(404).json({ success: false, error: 'Game not found' });
        }
        res.json({ success: true, ...result.rows[0] });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 6. REST API: Play a move
    context.router.post('/api/sudoku/:id/move', async (req, res) => {
      const gameId = req.params.id;
      const { cellIndex, value } = req.body; // cellIndex 0-80, value 0-9

      if (cellIndex < 0 || cellIndex > 80 || value < 0 || value > 9) {
        return res.status(400).json({ success: false, error: 'Invalid cell index or cell value' });
      }

      try {
        const gameRes = await context.db.query('SELECT grid, initial_grid, solution, status FROM sudoku_games WHERE id = $1', [gameId]);
        if (gameRes.rowCount === 0) {
          return res.status(404).json({ success: false, error: 'Game not found' });
        }

        const game = gameRes.rows[0];
        
        // Ensure user is not modifying starting cells
        if (game.initial_grid[cellIndex] !== '0') {
          return res.status(400).json({ success: false, error: 'Cannot modify starting puzzle cells.' });
        }

        // Update board array
        const gridArray = game.grid.split('');
        gridArray[cellIndex] = String(value);
        const newGridStr = gridArray.join('');

        // Verify if completely solved and matches solution
        let status = 'active';
        if (newGridStr === game.solution) {
          status = 'solved';
        }

        await context.db.query('UPDATE sudoku_games SET grid = $1, status = $2 WHERE id = $3', [newGridStr, status, gameId]);
        
        // Emit event for real-time synchronization (co-op)
        context.eventBus.emit('sudoku:move', { gameId, cellIndex, value, grid: newGridStr, status });

        res.json({ success: true, grid: newGridStr, status });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 7. REST API: Trigger Auto-Solver
    context.router.post('/api/sudoku/:id/solve', async (req, res) => {
      const gameId = req.params.id;
      try {
        const gameRes = await context.db.query('SELECT solution FROM sudoku_games WHERE id = $1', [gameId]);
        if (gameRes.rowCount === 0) {
          return res.status(404).json({ success: false, error: 'Game not found' });
        }

        const game = gameRes.rows[0];
        const solvedGrid = game.solution;

        await context.db.query('UPDATE sudoku_games SET grid = $1, status = $2 WHERE id = $3', [solvedGrid, 'solved', gameId]);
        
        // Emit solve event for real-time synchronization (co-op)
        context.eventBus.emit('sudoku:solve', { gameId, grid: solvedGrid, status: 'solved' });

        res.json({ success: true, grid: solvedGrid, status: 'solved' });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 8. REST API: Create a new game on-demand
    context.router.post('/api/sudoku', async (req, res) => {
      const gameId = crypto.randomUUID();
      const randomPuzzle = BASE_PUZZLES[Math.floor(Math.random() * BASE_PUZZLES.length)];
      const gridArray = randomPuzzle.split('').map(Number);
      const solvedArray = solveSudoku(gridArray);
      
      if (!solvedArray) {
        return res.status(500).json({ success: false, error: 'Failed to generate solvable sudoku puzzle.' });
      }
      
      const solutionStr = solvedArray.join('');

      try {
        await context.db.query(
          `INSERT INTO sudoku_games (id, grid, initial_grid, solution, status) 
           VALUES ($1, $2, $3, $4, $5)`,
          [gameId, randomPuzzle, randomPuzzle, solutionStr, 'active']
        );
        res.json({ success: true, id: gameId, grid: randomPuzzle, initial_grid: randomPuzzle, status: 'active' });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
  }
};
