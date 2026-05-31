import express from 'express';
import path from 'path';
import { FeatureModule, FeatureContext } from '../../core/registry';

interface PlayerConnection {
  playerId: string;
  nickname: string;
  lastSeen: number;
  res: express.Response;
}

// In-memory connection map: gameId -> map of playerId -> connection details
const activeConnections = new Map<string, Map<string, PlayerConnection>>();

// Broadcast active players list and their idle durations
function broadcastPresence(gameId: string) {
  const playersMap = activeConnections.get(gameId);
  if (!playersMap) return;

  const payload = JSON.stringify({
    type: 'presence',
    players: Array.from(playersMap.entries()).map(([pid, p]) => ({
      playerId: pid,
      nickname: p.nickname,
      idleSeconds: Math.floor((Date.now() - p.lastSeen) / 1000)
    }))
  });

  playersMap.forEach(p => {
    try {
      p.res.write(`data: ${payload}\n\n`);
    } catch (err: any) {
      console.warn('[Co-Op] Failed presence write:', err.message);
    }
  });
}

// Start presence polling loop every 5 seconds
setInterval(() => {
  for (const gameId of activeConnections.keys()) {
    broadcastPresence(gameId);
  }
}, 5000);

export const coopFeature: FeatureModule = {
  name: 'coop',

  onBoot: async (context: FeatureContext) => {
    console.log('[Co-Op] Booting feature routes...');

    // 1. Serve static client resources
    const publicPath = path.join(__dirname, 'public');
    context.router.use('/coop-client', express.static(publicPath));

    // 2. Server-Sent Events (SSE) Route with Presence Tracking
    context.router.get('/api/sudoku/:id/coop-stream', (req, res) => {
      const gameId = req.params.id;
      const playerId = req.query.playerId as string;
      const nickname = (req.query.nickname as string) || 'Anonymous';

      if (!playerId) {
        res.status(400).send('playerId query parameter is required');
        return;
      }

      // Set robust headers to prevent buffering/caching
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders(); // Keep connection stream open

      if (!activeConnections.has(gameId)) {
        activeConnections.set(gameId, new Map());
      }
      
      activeConnections.get(gameId)!.set(playerId, {
        playerId,
        nickname,
        lastSeen: Date.now(),
        res
      });

      console.log(`[Co-Op] Player joined stream: ${nickname} (${playerId}) for game ${gameId}. Total connections: ${activeConnections.get(gameId)!.size}`);

      // Initial keep-alive payload
      res.write('data: {"type": "connected"}\n\n');

      // Trigger presence broadcast immediately
      broadcastPresence(gameId);

      req.on('close', () => {
        const playersMap = activeConnections.get(gameId);
        if (playersMap) {
          playersMap.delete(playerId);
          if (playersMap.size === 0) {
            activeConnections.delete(gameId);
          }
        }
        console.log(`[Co-Op] Player disconnected: ${nickname} (${playerId}) for game ${gameId}. Remaining: ${playersMap ? playersMap.size : 0}`);
        broadcastPresence(gameId);
      });
    });

    // 3. API Route: Broadcast peer focus changes and update activity
    context.router.post('/api/sudoku/:id/focus', (req, res) => {
      const gameId = req.params.id;
      const { cellIndex, playerId, color, nickname } = req.body;

      const playersMap = activeConnections.get(gameId);
      if (playersMap && playersMap.has(playerId)) {
        // Update activity timestamp
        playersMap.get(playerId)!.lastSeen = Date.now();
      }

      if (cellIndex !== -2) {
        const payload = JSON.stringify({
          type: 'focus',
          cellIndex,
          playerId,
          color,
          nickname
        });

        // Broadcast to everyone else in the game
        if (playersMap) {
          playersMap.forEach(p => {
            if (p.playerId !== playerId) {
              try {
                p.res.write(`data: ${payload}\n\n`);
              } catch (err: any) {
                console.warn('[Co-Op] Failed write to client connection:', err.message);
              }
            }
          });
        }
      }

      res.json({ success: true });
    });

    // 4. Hook into Sudoku EventBus: Broadcast moves
    context.eventBus.on('sudoku:move', (eventData) => {
      const { gameId, cellIndex, value, grid, status } = eventData;
      const playersMap = activeConnections.get(gameId);
      if (!playersMap) return;

      const payload = JSON.stringify({
        type: 'move',
        cellIndex,
        value,
        grid,
        status
      });

      playersMap.forEach(p => {
        try {
          p.res.write(`data: ${payload}\n\n`);
        } catch (err: any) {
          console.warn('[Co-Op] Failed write on EventBus move:', err.message);
        }
      });
    });

    // 5. Hook into Sudoku EventBus: Broadcast solve state
    context.eventBus.on('sudoku:solve', (eventData) => {
      const { gameId, grid, status } = eventData;
      const playersMap = activeConnections.get(gameId);
      if (!playersMap) return;

      const payload = JSON.stringify({
        type: 'solve',
        grid,
        status
      });

      playersMap.forEach(p => {
        try {
          p.res.write(`data: ${payload}\n\n`);
        } catch (err: any) {
          console.warn('[Co-Op] Failed write on EventBus solve:', err.message);
        }
      });
    });
  }
};
