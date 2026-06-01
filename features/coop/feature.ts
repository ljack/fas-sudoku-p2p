import express from 'express';
import path from 'path';
import { FeatureModule, FeatureContext } from '../../core/registry';

// In-memory mapping: gameId -> Map of peerId -> SSE Response object
const activeSignalingConnections = new Map<string, Map<string, express.Response>>();

export const coopFeature: FeatureModule = {
  name: 'coop',

  onBoot: async (context: FeatureContext) => {
    console.log('[Co-Op] Booting WebRTC P2P signaling server...');

    // 1. Serve static client resources
    const publicPath = path.join(__dirname, 'public');
    context.router.use('/coop-client', express.static(publicPath));

    // 2. WebRTC Signaling SSE Stream
    context.router.get('/api/signal/:gameId/:peerId/stream', (req, res) => {
      const gameId = req.params.gameId;
      const peerId = req.params.peerId;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      if (!activeSignalingConnections.has(gameId)) {
        activeSignalingConnections.set(gameId, new Map());
      }
      activeSignalingConnections.get(gameId)!.set(peerId, res);

      console.log(`[Co-Op Signal] Peer joined signaling: ${peerId} for game ${gameId}. Active in room: ${activeSignalingConnections.get(gameId)!.size}`);

      // Confirm connection
      res.write(`data: ${JSON.stringify({ type: 'connected', peerId })}\n\n`);

      // Broadcast join event to all other peers in this game room
      const room = activeSignalingConnections.get(gameId)!;
      room.forEach((peerRes, otherPeerId) => {
        if (otherPeerId !== peerId) {
          try {
            peerRes.write(`data: ${JSON.stringify({ type: 'peer-joined', peerId })}\n\n`);
          } catch (e: any) {
            console.warn(`[Co-Op Signal] Failed to notify join to ${otherPeerId}:`, e.message);
          }
        }
      });

      req.on('close', () => {
        const room = activeSignalingConnections.get(gameId);
        if (room) {
          room.delete(peerId);
          if (room.size === 0) {
            activeSignalingConnections.delete(gameId);
          } else {
            // Broadcast leave event to remaining peers
            room.forEach((peerRes, otherPeerId) => {
              try {
                peerRes.write(`data: ${JSON.stringify({ type: 'peer-left', peerId })}\n\n`);
              } catch (e: any) {
                console.warn(`[Co-Op Signal] Failed to notify leave to ${otherPeerId}:`, e.message);
              }
            });
          }
        }
        console.log(`[Co-Op Signal] Peer left signaling: ${peerId} for game ${gameId}.`);
      });
    });

    // 3. WebRTC Signaling Packet Relay
    context.router.post('/api/signal/:gameId/:peerId/send', (req, res) => {
      const gameId = req.params.gameId;
      const senderId = req.params.peerId;
      const { recipientId, message } = req.body;

      if (!recipientId || !message) {
        res.status(400).json({ success: false, error: 'recipientId and message are required' });
        return;
      }

      const room = activeSignalingConnections.get(gameId);
      if (!room) {
        res.status(404).json({ success: false, error: 'Room not found' });
        return;
      }

      const recipientRes = room.get(recipientId);
      if (!recipientRes) {
        res.status(404).json({ success: false, error: `Recipient peer "${recipientId}" not found in this game` });
        return;
      }

      try {
        const payload = JSON.stringify({
          type: 'signal',
          senderId,
          message
        });
        recipientRes.write(`data: ${payload}\n\n`);
        res.json({ success: true });
      } catch (err: any) {
        console.error(`[Co-Op Signal] Failed to write packet to ${recipientId}:`, err.message);
        res.status(500).json({ success: false, error: 'Relay packet write failed' });
      }
    });

    // 4. Get active signaling peers in a room
    context.router.get('/api/signal/:gameId/peers', (req, res) => {
      const gameId = req.params.gameId;
      const room = activeSignalingConnections.get(gameId);
      if (!room) {
        res.json({ success: true, peers: [] });
        return;
      }
      res.json({ success: true, peers: Array.from(room.keys()) });
    });
  }
};
