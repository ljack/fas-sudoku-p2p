(function() {
  const oldLog = console.log;
  console.log = function(...args) {
    oldLog.apply(console, args);
    const msg = args.join(' ');
    const logs = document.getElementById('diagnostic-logs');
    if (logs) {
      logs.textContent += `\n[P2P] ${msg}`;
      logs.scrollTop = logs.scrollHeight;
    }
  };
  const oldWarn = console.warn;
  console.warn = function(...args) {
    oldWarn.apply(console, args);
    const msg = args.join(' ');
    const logs = document.getElementById('diagnostic-logs');
    if (logs) {
      logs.textContent += `\n[P2P Warning] ${msg}`;
      logs.scrollTop = logs.scrollHeight;
    }
  };

  console.log('[FAS Plugin] Injecting 1-Way Manual WebRTC P2P Engine...');

  // 1. Establish player identity
  const colorList = [
    'hsl(140, 80%, 65%)', // Emerald Green
    'hsl(330, 85%, 70%)', // Neon Pink
    'hsl(40, 95%, 60%)',  // Sun Gold
    'hsl(200, 90%, 65%)', // Sky Blue
    'hsl(270, 90%, 70%)'  // Electric Purple
  ];
  const myColor = colorList[Math.floor(Math.random() * colorList.length)];
  const nameList = ['Solar Solver', 'Quantum Solver', 'P2P Brain', 'IPv6 Voyager', 'Gravity Solver', 'Grid Titan'];
  const myNickname = nameList[Math.floor(Math.random() * nameList.length)] + ' #' + Math.floor(Math.random() * 900 + 100);

  // 2. Parse URL hash to determine role and game configuration
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
  
  // If hash contains an offer, this peer is a Client. If not, this peer is the Host.
  const isHost = !hasOfferInHash;
  const gameId = hashParams.gameId || 'game_' + Math.random().toString(36).substring(2, 9);
  const myPeerId = isHost ? 'host' : 'client_' + Math.random().toString(36).substring(2, 9);
  
  console.log(`[P2P Profile] Peer ID: ${myPeerId} (${isHost ? 'Host' : 'Client'}), Nickname: ${myNickname}`);

  // 3. WebRTC Configuration (Using public Google STUN for ICE gathering)
  const config = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  let p2pStatus = 'disconnected'; // 'disconnected', 'gathering', 'handshaking', 'connected'
  let pc = null;
  let dc = null;
  let discoveredIPs = new Set();
  let activePlayers = [];

  // Update connection status in UI console
  function updateUIStatus(statusText, extra = '') {
    p2pStatus = statusText;
    const ipList = Array.from(discoveredIPs).filter(ip => ip.includes(':') || ip.split('.').length === 4);
    const hasIPv6 = ipList.some(ip => ip.includes(':'));

    window.dispatchEvent(new CustomEvent('sudoku:p2pStatus', {
      detail: {
        status: p2pStatus,
        mode: 'manual',
        isHost,
        peerId: myPeerId,
        nickname: myNickname,
        color: myColor,
        hasIPv6,
        ips: ipList,
        players: activePlayers,
        extra
      }
    }));
  }

  // Extract IP addresses from candidates (especially looking for public IPv6 routes)
  function inspectCandidate(candidateString) {
    if (!candidateString) return;
    try {
      const parts = candidateString.split(' ');
      if (parts.length > 4) {
        const ip = parts[4];
        if (ip && !ip.endsWith('.local') && ip !== '0.0.0.0' && ip !== '127.0.0.1') {
          discoveredIPs.add(ip);
          updateUIStatus(p2pStatus);
        }
      }
    } catch (e) {
      console.warn('Error parsing candidate IP:', e);
    }
  }

  // 4. Initialize WebRTC peer connection
  async function setupWebRTC() {
    pc = new RTCPeerConnection(config);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        inspectCandidate(event.candidate.candidate);
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log(`[ICE Gathering] State changed to: ${pc.iceGatheringState}`);
      if (pc.iceGatheringState === 'complete') {
        onIceGatheringComplete();
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[P2P Connection] State: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        updateUIStatus('connected');
        console.log('[P2P Connection] Direct DTLS/SCTP link established!');
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        cleanup();
      }
    };

    if (isHost) {
      // 5. Host flow: Create and own the data channel
      console.log('[P2P Setup] Host initializing peer connection...');
      dc = pc.createDataChannel('game-data', { negotiated: false });
      setupDataChannelListeners(dc, 'client');
      
      updateUIStatus('gathering');
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('[P2P Setup] Offer SDP generated. Gathering ICE paths...');
    } else {
      // 6. Client flow: Consume offer and wait for Host data channel
      console.log('[P2P Setup] Client initializing peer connection from URL Offer...');
      pc.ondatachannel = (event) => {
        console.log('[P2P Connection] Received data channel from Host.');
        dc = event.channel;
        setupDataChannelListeners(dc, 'host');
      };

      try {
        const hostOffer = JSON.parse(atob(hashParams.offer));
        await pc.setRemoteDescription(new RTCSessionDescription(hostOffer));
        console.log('[P2P Setup] Applied Host remote description from URL.');
        
        updateUIStatus('gathering');
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log('[P2P Setup] Answer SDP generated. Gathering ICE paths...');
      } catch (err) {
        console.error('[P2P Setup] Failed to parse offer SDP in URL hash:', err);
        updateUIStatus('disconnected', 'Corrupted or expired URL Offer token.');
      }
    }
  }

  // 7. Triggered when ICE gathering is finished (Vanilla ICE)
  function onIceGatheringComplete() {
    const localSDP = pc.localDescription;
    const sdpToken = btoa(JSON.stringify(localSDP));

    if (isHost) {
      // Host generates the shareable game URL containing the offer token
      const grid = window.sudokuInitialGrid || hashParams.grid || '';
      const shareURL = `${window.location.origin}${window.location.pathname}#gameId=${gameId}&grid=${grid}&offer=${sdpToken}`;
      
      window.dispatchEvent(new CustomEvent('sudoku:manualOfferReady', {
        detail: { shareURL }
      }));
      updateUIStatus('handshaking', 'Shareable URL generated. Awaiting client answer...');
    } else {
      // Client generates its answer token to be pasted back on the Host
      window.dispatchEvent(new CustomEvent('sudoku:manualAnswerReady', {
        detail: { token: sdpToken }
      }));
      updateUIStatus('handshaking', 'Answer token generated. Send it to the Host.');
    }
  }

  // 8. Host applies the client's answer token to finish the connection
  async function applyClientAnswer(token) {
    if (!isHost || !pc) return;
    try {
      console.log('[P2P Connection] Applying Client answer token...');
      const clientAnswer = JSON.parse(atob(token));
      await pc.setRemoteDescription(new RTCSessionDescription(clientAnswer));
      console.log('[P2P Connection] Client answer applied. Connecting...');
      updateUIStatus('connecting');
    } catch (err) {
      console.error('[P2P Connection] Failed to parse remote answer token:', err);
      alert('Failed to parse answer token. Ensure you copied the entire text.');
    }
  }

  // 9. Data Channel Setup & Message Routing
  function setupDataChannelListeners(channel, targetPeerId) {
    channel.onopen = () => {
      console.log(`[P2P Link] Channel open with ${targetPeerId}`);
      sendDirectMessage(channel, {
        type: 'intro',
        nickname: myNickname,
        color: myColor,
        isHost
      });

      if (isHost) {
        // Sync board state to client
        window.dispatchEvent(new CustomEvent('sudoku:requestStateSync', {
          detail: { recipientId: targetPeerId }
        }));
      }
      updateActivePlayers();
      updateUIStatus('connected');
    };

    channel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== 'heartbeat') {
          console.log(`[P2P Receive] Type: ${msg.type}`);
        }
        handleDataMessage(targetPeerId, msg);
      } catch (err) {
        console.error('[P2P Link] Parse error:', err);
      }
    };

    channel.onclose = () => {
      console.log(`[P2P Link] Channel closed with ${targetPeerId}`);
      cleanup();
    };
  }

  function handleDataMessage(senderId, msg) {
    switch (msg.type) {
      case 'intro':
        activePlayers = [{
          playerId: myPeerId,
          nickname: myNickname,
          color: myColor,
          isHost
        }, {
          playerId: senderId,
          nickname: msg.nickname,
          color: msg.color,
          isHost: msg.isHost
        }];
        updateUIStatus(p2pStatus);
        break;

      case 'state-sync':
        if (!isHost) {
          console.log('[P2P Client] Synchronizing board from Host');
          window.dispatchEvent(new CustomEvent('sudoku:syncState', {
            detail: {
              initialGrid: msg.initialGrid,
              currentGrid: msg.currentGrid,
              status: msg.status
            }
          }));
        }
        break;

      case 'move':
        if (isHost) {
          console.log(`[P2P Host] Validating move from client: Cell ${msg.cellIndex} -> ${msg.value}`);
          window.dispatchEvent(new CustomEvent('sudoku:localMove', {
            detail: { cellIndex: msg.cellIndex, value: msg.value, isExternal: true, senderId }
          }));
        } else {
          window.dispatchEvent(new CustomEvent('sudoku:externalMove', {
            detail: { grid: msg.grid, status: msg.status }
          }));
        }
        break;

      case 'solve':
        if (isHost) {
          window.dispatchEvent(new CustomEvent('sudoku:localSolve', { detail: { senderId } }));
        } else {
          window.dispatchEvent(new CustomEvent('sudoku:externalSolve', {
            detail: { grid: msg.grid, status: msg.status }
          }));
        }
        break;

      case 'focus':
        window.dispatchEvent(new CustomEvent('sudoku:externalFocus', {
          detail: {
            cellIndex: msg.cellIndex,
            playerId: senderId,
            color: msg.color,
            nickname: msg.nickname
          }
        }));
        break;

      case 'heartbeat':
        break;

      default:
        break;
    }
  }

  // 10. Send Helpers
  function sendDirectMessage(channel, payload) {
    if (channel && channel.readyState === 'open') {
      try {
        if (payload.type !== 'heartbeat') {
          console.log(`[P2P Send] Type: ${payload.type}`);
        }
        channel.send(JSON.stringify(payload));
      } catch (e) {
        console.error('[P2P Send] Write error:', e);
      }
    }
  }

  function broadcastMessage(payload) {
    if (dc) {
      sendDirectMessage(dc, payload);
    }
  }

  function updateActivePlayers() {
    activePlayers = [{
      playerId: myPeerId,
      nickname: myNickname,
      color: myColor,
      isHost
    }];
  }

  // Periodic Keep-alives
  setInterval(() => {
    broadcastMessage({ type: 'heartbeat' });
  }, 5000);

  function cleanup() {
    console.log('[P2P Connection] Cleaning up local links...');
    if (dc) { dc.close(); dc = null; }
    if (pc) { pc.close(); pc = null; }
    document.querySelectorAll('[class^="peer-highlight-"]').forEach(el => el.remove());
    updateUIStatus('disconnected');
  }

  // 11. Binds triggers from sudoku app.js
  window.addEventListener('sudoku:p2pSendMove', (e) => {
    broadcastMessage({
      type: 'move',
      cellIndex: e.detail.cellIndex,
      value: e.detail.value,
      grid: e.detail.grid,
      status: e.detail.status
    });
  });

  window.addEventListener('sudoku:p2pSendSolve', (e) => {
    broadcastMessage({
      type: 'solve',
      grid: e.detail.grid,
      status: e.detail.status
    });
  });

  window.addEventListener('sudoku:p2pSendFocus', (e) => {
    broadcastMessage({
      type: 'focus',
      cellIndex: e.detail.cellIndex,
      color: myColor,
      nickname: myNickname
    });
  });

  window.addEventListener('sudoku:p2pSyncRequested', (e) => {
    sendDirectMessage(dc, {
      type: 'state-sync',
      initialGrid: e.detail.initialGrid,
      currentGrid: e.detail.currentGrid,
      status: e.detail.status
    });
  });

  window.addEventListener('sudoku:submitManualToken', (e) => {
    applyClientAnswer(e.detail.token);
  });

  window.addEventListener('sudoku:triggerManualOffer', () => {
    setupWebRTC();
  });

  // Automatically start gathering on load if we have a hash offer (Client flow)
  if (hasOfferInHash) {
    console.log('[P2P Setup] Offer found in URL hash. Starting Client setup...');
    // Give app.js a fraction of a second to bind its event listeners first
    setTimeout(setupWebRTC, 100);
  } else {
    // Host waits for the user to click "Generate Offer URL" or we can start automatically
    console.log('[P2P Setup] Ready to host. Click "Generate Connection Link" to begin.');
  }

})();
