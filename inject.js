(async function() {
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

  console.log('[FAS Plugin] Injecting Mesh WebRTC P2P Engine...');

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

  // Compression & Decompression Utilities
  const isCompressionSupported = typeof window.CompressionStream !== 'undefined' && typeof window.DecompressionStream !== 'undefined';

  async function compressText(text) {
    if (!isCompressionSupported) return null;
    const stream = new Blob([text]).stream();
    const compressedStream = stream.pipeThrough(new CompressionStream('deflate'));
    const buffer = await new Response(compressedStream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  async function decompressText(bytes) {
    if (!isCompressionSupported) return '';
    const stream = new Blob([bytes]).stream();
    const decompressedStream = stream.pipeThrough(new DecompressionStream('deflate'));
    return await new Response(decompressedStream).text();
  }

  function uint8ArrayToBase64Url(uint8Array) {
    let binary = '';
    const len = uint8Array.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

  // 2. Parse URL hash to determine role and game configuration
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

  const hashParams = await getHashParams();
  const hasOfferInHash = !!hashParams.offer;
  
  // If hash contains an offer, this peer is a Client. If not, this peer is the Host.
  const isHost = !hasOfferInHash;
  const gameId = hashParams.gameId || 'game_' + Math.random().toString(36).substring(2, 9);
  const myPeerId = isHost ? 'host' : 'client_' + Math.random().toString(36).substring(2, 9);
  
  console.log(`[P2P Profile] Peer ID: ${myPeerId} (${isHost ? 'Host' : 'Client'}), Nickname: ${myNickname}`);


  // WebRTC Stun config
  const config = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  let p2pStatus = 'disconnected';
  let discoveredIPs = new Set();
  
  // Mesh Data Structures
  let slots = {}; // maps slotId -> { id, pc, dc, status, clientInfo, isAuto }
  let proxiedPeers = {}; // Host maps proxiedPeerId -> proxyPeerId (relaying client)
  let activePlayers = [{
    playerId: myPeerId,
    nickname: myNickname,
    color: myColor,
    isHost
  }];
  
  let messageSeq = 0;
  const seenMessages = new Set();
  let primaryRouteSlotId = null; // Client's primary route connection to the Host

  // Update status and broadcast presence details to UI
  function updateUIStatus(statusText, extra = '') {
    p2pStatus = statusText;
    const ipList = Array.from(discoveredIPs).filter(ip => ip.includes(':') || ip.split('.').length === 4);
    const hasIPv6 = ipList.some(ip => ip.includes(':'));

    const simplifiedSlots = {};
    for (const sid in slots) {
      simplifiedSlots[sid] = {
        id: sid,
        status: slots[sid].status,
        nickname: slots[sid].clientInfo ? slots[sid].clientInfo.nickname : null,
        color: slots[sid].clientInfo ? slots[sid].clientInfo.color : null,
        isAuto: slots[sid].isAuto
      };
    }

    console.log('[E2E Debug INJECT] dispatching sudoku:p2pStatus statusText:', statusText, 'p2pStatus:', p2pStatus);
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
        slots: simplifiedSlots,
        extra
      }
    }));
  }

  // Extract IPs from candidate profiles
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

  // 4. Initialize Slot Connection
  async function setupWebRTC(slotId, remoteOffer = null) {
    console.log(`[P2P Setup] Initializing connection for slot: ${slotId}`);
    
    // Clean up existing slot if any
    if (slots[slotId]) {
      try { slots[slotId].pc.close(); } catch(e) {}
      delete slots[slotId];
    }

    const pc = new RTCPeerConnection(config);
    slots[slotId] = {
      id: slotId,
      pc: pc,
      dc: null,
      status: 'disconnected',
      clientInfo: null,
      isAuto: slotId.startsWith('auto_')
    };

    let gatheringCompleteCalled = false;
    let gatheringTimeout = null;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        inspectCandidate(event.candidate.candidate);
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log(`[ICE Gathering][${slotId}] State changed to: ${pc.iceGatheringState}`);
      if (pc.iceGatheringState === 'complete') {
        if (!gatheringCompleteCalled) {
          gatheringCompleteCalled = true;
          if (gatheringTimeout) clearTimeout(gatheringTimeout);
          onIceGatheringComplete(slotId);
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[P2P Connection][${slotId}] State: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        slots[slotId].status = 'connected';
        
        // If client and we connected to parent_slot, make it primary
        if (!isHost && slotId === 'parent_slot') {
          primaryRouteSlotId = 'parent_slot';
        }
        updateUIStatus(slots[slotId].isAuto ? p2pStatus : 'connected');
        console.log(`[P2P Connection][${slotId}] Link successfully established!`);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        handleSlotClosed(slotId);
      }
    };

    if (remoteOffer) {
      // Client/Receiver setup
      pc.ondatachannel = (event) => {
        console.log(`[P2P Setup][${slotId}] Received remote data channel.`);
        slots[slotId].dc = event.channel;
        setupDataChannelListeners(event.channel, slotId);
      };

      try {
        const sdpInit = (remoteOffer.sdp && typeof remoteOffer.sdp === 'object') ? remoteOffer.sdp : remoteOffer;
        await pc.setRemoteDescription(new RTCSessionDescription(sdpInit));
        slots[slotId].status = 'gathering';
        updateUIStatus(p2pStatus);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Start safety timeout for ICE gathering (4 seconds)
        gatheringTimeout = setTimeout(() => {
          if (!gatheringCompleteCalled) {
            gatheringCompleteCalled = true;
            console.log(`[ICE Gathering][${slotId}] Gathering timed out (4s), proceeding with current candidates.`);
            onIceGatheringComplete(slotId);
          }
        }, 4000);
      } catch (err) {
        console.error(`[P2P Setup][${slotId}] Offer application failed:`, err);
        slots[slotId].status = 'disconnected';
        updateUIStatus('disconnected', 'Offer parsing error.');
      }
    } else {
      // Host/Initiator setup
      const dc = pc.createDataChannel('game-data', { negotiated: false });
      slots[slotId].dc = dc;
      setupDataChannelListeners(dc, slotId);

      slots[slotId].status = 'gathering';
      updateUIStatus(p2pStatus);

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Start safety timeout for ICE gathering (4 seconds)
        gatheringTimeout = setTimeout(() => {
          if (!gatheringCompleteCalled) {
            gatheringCompleteCalled = true;
            console.log(`[ICE Gathering][${slotId}] Gathering timed out (4s), proceeding with current candidates.`);
            onIceGatheringComplete(slotId);
          }
        }, 4000);
      } catch (err) {
        console.error(`[P2P Setup][${slotId}] Offer creation failed:`, err);
        slots[slotId].status = 'disconnected';
        updateUIStatus(p2pStatus);
      }
    }
  }

  // Called when SDP is fully gathered
  async function onIceGatheringComplete(slotId) {
    const slot = slots[slotId];
    if (!slot) return;

    let minifiedSdp = slot.pc.localDescription.sdp || '';
    if (minifiedSdp && minifiedSdp.includes('\r\n')) {
      minifiedSdp = minifiedSdp.split('\r\n')
        .filter(line => {
          if (!line.trim()) return false;
          if (line.startsWith('a=candidate:') && line.includes(' tcp ')) return false;
          if (line.startsWith('a=extmap-allow-mixed')) return false;
          if (line.startsWith('a=msid-semantic:')) return false;
          return true;
        })
        .join('\r\n');
      if (!minifiedSdp.endsWith('\r\n')) minifiedSdp += '\r\n';
    }

    const offerObj = {
      sdp: {
        type: slot.pc.localDescription.type,
        sdp: minifiedSdp
      },
      slotId: slotId,
      peerId: myPeerId,
      nickname: myNickname,
      color: myColor
    };

    const sdpToken = btoa(JSON.stringify(offerObj));

    if (slot.pc.localDescription.type === 'offer') {
      // We are the initiator (either Host or a client creating a proxy link)
      const grid = window.sudokuInitialGrid || hashParams.grid || '';
      
      let shareURL = '';
      if (isCompressionSupported) {
        try {
          const inviteData = {
            gameId: gameId,
            grid: grid,
            offer: offerObj
          };
          if (!isHost) {
            inviteData.proxyPeerId = myPeerId;
          }
          const inviteStr = JSON.stringify(inviteData);
          const compressedBytes = await compressText(inviteStr);
          const compressedToken = uint8ArrayToBase64Url(compressedBytes);
          shareURL = `${window.location.origin}${window.location.pathname}#j_${compressedToken}`;
        } catch (err) {
          console.error('[P2P] Compression failed, falling back to legacy URL format:', err);
        }
      }

      if (!shareURL) {
        shareURL = `${window.location.origin}${window.location.pathname}#gameId=${encodeURIComponent(gameId)}&grid=${encodeURIComponent(grid)}&offer=${encodeURIComponent(sdpToken)}&slotId=${encodeURIComponent(slotId)}`;
        if (!isHost) {
          shareURL += `&proxyPeerId=${encodeURIComponent(myPeerId)}`;
        }
      }

      // Auto slot offers are tunneled via data channel, not manually copy-pasted
      if (slot.isAuto) {
        const targetPeerId = slotId.replace('auto_', '');
        console.log(`[P2P Auto-Signaling] Sending background offer to peer: ${targetPeerId}`);
        sendToPeer(targetPeerId, {
          type: 'signal-offer',
          srcPeerId: myPeerId,
          destPeerId: targetPeerId,
          sdp: slot.pc.localDescription
        });
      } else {
        window.dispatchEvent(new CustomEvent('sudoku:manualOfferReady', {
          detail: { slotId, shareURL }
        }));
        slot.status = 'handshaking';
        updateUIStatus(p2pStatus, 'Invite URL ready for slot ' + slotId);
      }
    } else {
      // We are responding to an offer
      if (slot.isAuto) {
        const targetPeerId = slotId.replace('auto_', '');
        console.log(`[P2P Auto-Signaling] Sending background answer to peer: ${targetPeerId}`);
        sendToPeer(targetPeerId, {
          type: 'signal-answer',
          srcPeerId: myPeerId,
          destPeerId: targetPeerId,
          sdp: slot.pc.localDescription
        });
      } else {
        window.dispatchEvent(new CustomEvent('sudoku:manualAnswerReady', {
          detail: { slotId, token: sdpToken }
        }));
        slot.status = 'handshaking';
        updateUIStatus(p2pStatus, 'Answer token ready.');
      }
    }
  }

  async function resolveSDPToken(input) {
    if (!input) return null;
    let token = input.trim();
    
    // Check if it's a URL or contains hash
    if (token.includes('http://') || token.includes('https://') || token.includes('#')) {
      const hashIndex = token.indexOf('#');
      if (hashIndex !== -1) {
        const hash = token.substring(hashIndex + 1);
        if (hash.startsWith('j_')) {
          try {
            const compressedToken = hash.substring(2);
            const bytes = base64UrlToUint8Array(compressedToken);
            const decompressed = await decompressText(bytes);
            const inviteData = JSON.parse(decompressed);
            return inviteData.offer;
          } catch (err) {
            console.error('[P2P] Failed to resolve compressed hash URL:', err);
            return null;
          }
        } else {
          const params = {};
          hash.split('&').forEach(pair => {
            const [key, val] = pair.split('=');
            if (key && val) params[key] = decodeURIComponent(val);
          });
          if (params.offer) {
            try {
              return JSON.parse(atob(params.offer));
            } catch (e) {
              console.error('[P2P] Failed to parse legacy offer from hash:', e);
            }
          }
        }
      }
      
      const offerMatch = token.match(/offer=([^&\s]+)/);
      if (offerMatch) {
        try {
          return JSON.parse(atob(decodeURIComponent(offerMatch[1])));
        } catch (e) {}
      }
    }
    
    // Raw tokens
    if (token.startsWith('j_')) {
      try {
        const compressedToken = token.substring(2);
        const bytes = base64UrlToUint8Array(compressedToken);
        const decompressed = await decompressText(bytes);
        const inviteData = JSON.parse(decompressed);
        return inviteData.offer;
      } catch (err) {
        console.error('[P2P] Failed to resolve raw compressed token:', err);
        return null;
      }
    }
    
    try {
      return JSON.parse(atob(token));
    } catch (err) {
      console.error('[P2P] Failed to parse raw legacy token:', err);
      return null;
    }
  }

  // Connect slot with pasting answer or offer token
  async function applyManualToken(pastedText, slotId) {
    try {
      console.log(`[P2P Connection][${slotId}] Processing remote token...`);
      const tokenObj = await resolveSDPToken(pastedText);
      if (!tokenObj) {
        alert('Failed to parse remote token. Please make sure you copied the entire message.');
        return;
      }
      const sdpType = tokenObj.sdp && tokenObj.sdp.type;

      if (sdpType === 'offer') {
        console.log(`[P2P Connection] Manually received Offer. Initializing connection...`);
        let gid = null;
        let grid = null;

        if (pastedText.includes('#j_')) {
          try {
            const hashIndex = pastedText.indexOf('#');
            const hash = pastedText.substring(hashIndex + 1);
            const compressedToken = hash.substring(2);
            const bytes = base64UrlToUint8Array(compressedToken);
            const decompressed = await decompressText(bytes);
            const inviteData = JSON.parse(decompressed);
            gid = inviteData.gameId;
            grid = inviteData.grid;
          } catch(e) {}
        } else if (pastedText.includes('gameId=')) {
          const gameIdMatch = pastedText.match(/gameId=([^&\s]+)/);
          const gridMatch = pastedText.match(/grid=([^&\s]+)/);
          if (gameIdMatch) gid = decodeURIComponent(gameIdMatch[1]);
          if (gridMatch) grid = decodeURIComponent(gridMatch[1]);
        }

        if (gid) {
          window.location.hash = `gameId=${gid}${grid ? '&grid=' + grid : ''}`;
          console.log(`[P2P Connection] Loaded game from manual paste: ${gid}`);
        }
        setupWebRTC('parent_slot', tokenObj);
      } else if (sdpType === 'answer') {
        const slot = slots[slotId];
        if (!slot) {
          console.warn(`[P2P Connection] Slot ${slotId} not found to apply answer.`);
          alert(`Slot ${slotId} is not ready to receive an answer.`);
          return;
        }
        await slot.pc.setRemoteDescription(new RTCSessionDescription(tokenObj.sdp));
        slot.status = 'connecting';
        updateUIStatus('connecting');
      } else {
        alert('Invalid token format.');
      }
    } catch (err) {
      console.error(`[P2P Connection][${slotId}] Token application failed:`, err);
      alert('Failed to parse remote token. Please make sure you copied the entire message.');
    }
  }

  // Data Channel Handlers
  function setupDataChannelListeners(channel, slotId) {
    channel.onopen = () => {
      console.log(`[P2P Link][${slotId}] Data Channel is open.`);
      
      // Send identity intro
      sendDirectMessage(channel, {
        type: 'intro',
        peerId: myPeerId,
        nickname: myNickname,
        color: myColor,
        isHost
      });

      // If client and we just connected to the primary path, query state sync
      if (!isHost && slotId === 'parent_slot') {
        window.dispatchEvent(new CustomEvent('sudoku:requestStateSync', {
          detail: { recipientId: 'host' }
        }));
      }
    };

    channel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        // Deduplicate messages to prevent routing loops in multi-path mesh
        if (msg.msgId) {
          if (seenMessages.has(msg.msgId)) return;
          seenMessages.add(msg.msgId);
          if (seenMessages.size > 300) {
            const first = seenMessages.values().next().value;
            seenMessages.delete(first);
          }
        }
        
        if (msg.type !== 'heartbeat') {
          console.log(`[P2P Receive] Type: ${msg.type} from slot: ${slotId}`);
        }
        
        handleDataMessage(slotId, msg);
      } catch (err) {
        console.error('[P2P Link] Parse error:', err);
      }
    };

    channel.onclose = () => {
      console.log(`[P2P Link][${slotId}] Channel closed.`);
      handleSlotClosed(slotId);
    };
  }

  // Central Router for Mesh Messages
  function handleDataMessage(slotId, msg) {
    const senderSlot = slots[slotId];
    const directSenderId = senderSlot && senderSlot.clientInfo ? senderSlot.clientInfo.peerId : null;

    switch (msg.type) {
      case 'intro':
        // Save client profile info in slot
        if (slots[slotId]) {
          slots[slotId].clientInfo = {
            peerId: msg.peerId,
            nickname: msg.nickname,
            color: msg.color,
            isHost: msg.isHost
          };
        }

        if (isHost) {
          // Register player
          registerActivePlayer({
            playerId: msg.peerId,
            nickname: msg.nickname,
            color: msg.color,
            isHost: false
          });
          
          broadcastPlayersList();
          
          // Trigger board state sync
          window.dispatchEvent(new CustomEvent('sudoku:requestStateSync', {
            detail: { recipientId: msg.peerId }
          }));
        } else {
          // If we are a Client, and this is a downstream connection (acting as Proxy)
          if (slotId !== 'parent_slot' && !slots[slotId].isAuto) {
            console.log(`[P2P Proxy] Registering downstream child peer: ${msg.peerId} with Host...`);
            sendToHost({
              type: 'proxy-register',
              peerId: msg.peerId,
              nickname: msg.nickname,
              color: msg.color
            });
          }
        }
        updateUIStatus(p2pStatus);
        break;

      case 'proxy-register':
        // Only host handles proxy registrations
        if (isHost) {
          console.log(`[P2P Host] Registering proxied peer ${msg.peerId} via proxy ${directSenderId}`);
          proxiedPeers[msg.peerId] = directSenderId;
          
          registerActivePlayer({
            playerId: msg.peerId,
            nickname: msg.nickname,
            color: msg.color,
            isHost: false,
            proxyId: directSenderId
          });
          
          broadcastPlayersList();
          
          // Trigger board state sync for the proxied client
          window.dispatchEvent(new CustomEvent('sudoku:requestStateSync', {
            detail: { recipientId: msg.peerId }
          }));

          // AUTO-SIGNALING BOOTSTRAP: Host automatically initiates a background connection with Client 2
          console.log(`[P2P Auto-Signaling] Initiating background fallback path directly with: ${msg.peerId}`);
          setupWebRTC('auto_' + msg.peerId);
        }
        break;

      case 'proxy-deregister':
        if (isHost) {
          console.log(`[P2P Host] Deregistering proxied peer ${msg.peerId}`);
          delete proxiedPeers[msg.peerId];
          activePlayers = activePlayers.filter(p => p.playerId !== msg.peerId);
          broadcastPlayersList();
          updateUIStatus(p2pStatus);
        }
        break;

      case 'proxy-message':
        // Relay messages through intermediate node
        if (msg.targetPeerId === myPeerId) {
          // This is for us! Unwrap it and handle locally
          handleDataMessage(slotId, msg.payload);
        } else {
          // Forward wrapper along paths
          console.log(`[P2P Relay] Forwarding proxy-message from ${directSenderId} to ${msg.targetPeerId}`);
          sendToPeer(msg.targetPeerId, msg);
        }
        break;

      case 'signal-offer':
        if (msg.destPeerId === myPeerId) {
          console.log(`[P2P Auto-Signaling] Received background offer from: ${msg.srcPeerId}. Answering...`);
          setupWebRTC('auto_' + msg.srcPeerId, msg.sdp);
        } else {
          console.log(`[P2P Relay] Relaying signal-offer from ${msg.srcPeerId} to ${msg.destPeerId}`);
          sendToPeer(msg.destPeerId, msg);
        }
        break;

      case 'signal-answer':
        if (msg.destPeerId === myPeerId) {
          console.log(`[P2P Auto-Signaling] Received background answer from: ${msg.srcPeerId}. Establishing link.`);
          applyManualToken(btoa(JSON.stringify({ sdp: msg.sdp })), 'auto_' + msg.srcPeerId);
        } else {
          console.log(`[P2P Relay] Relaying signal-answer from ${msg.srcPeerId} to ${msg.destPeerId}`);
          sendToPeer(msg.destPeerId, msg);
        }
        break;

      case 'players-sync':
        if (!isHost) {
          activePlayers = msg.players;
          updateUIStatus(p2pStatus);
        }
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
          const actualSenderId = msg.senderId || directSenderId;
          console.log(`[P2P Host] Validating move from client ${actualSenderId}: Cell ${msg.cellIndex} -> ${msg.value}`);
          window.dispatchEvent(new CustomEvent('sudoku:localMove', {
            detail: { cellIndex: msg.cellIndex, value: msg.value, isExternal: true, senderId: actualSenderId }
          }));
        } else {
          if (slotId !== 'parent_slot') {
            console.log(`[P2P Proxy] Relaying move from downstream client ${msg.senderId || directSenderId} to Host.`);
            if (!msg.senderId) msg.senderId = directSenderId;
            sendToHost(msg);
          } else {
            window.dispatchEvent(new CustomEvent('sudoku:externalMove', {
              detail: { grid: msg.grid, status: msg.status }
            }));
          }
        }
        break;

      case 'solve':
        if (isHost) {
          const actualSenderId = msg.senderId || directSenderId;
          window.dispatchEvent(new CustomEvent('sudoku:localSolve', { detail: { senderId: actualSenderId } }));
        } else {
          if (slotId !== 'parent_slot') {
            console.log(`[P2P Proxy] Relaying solve from downstream client ${msg.senderId || directSenderId} to Host.`);
            if (!msg.senderId) msg.senderId = directSenderId;
            sendToHost(msg);
          } else {
            window.dispatchEvent(new CustomEvent('sudoku:externalSolve', {
              detail: { grid: msg.grid, status: msg.status }
            }));
          }
        }
        break;

      case 'focus':
        if (!isHost && slotId !== 'parent_slot') {
          console.log(`[P2P Proxy] Relaying focus from downstream client ${msg.senderId || directSenderId} to Host.`);
          if (!msg.senderId) msg.senderId = directSenderId;
          sendToHost(msg);
          break;
        }
        const actualSenderId = msg.senderId || directSenderId;
        if (isHost) {
          relayMessageToAll({
            type: 'focus',
            cellIndex: msg.cellIndex,
            senderId: actualSenderId,
            color: msg.color,
            nickname: msg.nickname
          }, actualSenderId);
        }
        
        // Find player color/name
        const player = activePlayers.find(p => p.playerId === actualSenderId);
        window.dispatchEvent(new CustomEvent('sudoku:externalFocus', {
          detail: {
            cellIndex: msg.cellIndex,
            playerId: actualSenderId,
            color: player ? player.color : msg.color,
            nickname: player ? player.nickname : msg.nickname
          }
        }));
        break;

      case 'heartbeat':
        break;

      default:
        break;
    }
  }

  // Network Route Forwarding Utilities
  function sendToHost(payload) {
    if (!payload.msgId) {
      payload.msgId = myPeerId + "_" + (++messageSeq);
    }
    seenMessages.add(payload.msgId);

    if (!isHost && !payload.senderId) {
      payload.senderId = myPeerId;
    }

    if (primaryRouteSlotId && slots[primaryRouteSlotId] && slots[primaryRouteSlotId].dc) {
      sendDirectMessage(slots[primaryRouteSlotId].dc, payload);
    } else {
      console.warn('[P2P Route] Attempted to send to host, but no active primary path.');
    }
  }

  function sendToPeer(targetPeerId, payload) {
    if (targetPeerId === 'host') {
      sendToHost(payload);
      return;
    }
    // If we are Host, check direct slots or proxies
    if (isHost) {
      // 1. Direct slot match
      for (const sid in slots) {
        if (slots[sid].clientInfo && slots[sid].clientInfo.peerId === targetPeerId) {
          if (slots[sid].dc && slots[sid].dc.readyState === 'open') {
            sendDirectMessage(slots[sid].dc, payload);
            return;
          }
        }
      }
      // 2. Proxied routing
      const proxyId = proxiedPeers[targetPeerId];
      if (proxyId) {
        for (const sid in slots) {
          if (slots[sid].clientInfo && slots[sid].clientInfo.peerId === proxyId) {
            if (slots[sid].dc && slots[sid].dc.readyState === 'open') {
              sendDirectMessage(slots[sid].dc, {
                type: 'proxy-message',
                targetPeerId: targetPeerId,
                payload: payload
              });
              return;
            }
          }
        }
      }
    } else {
      // Client relays everything down-link or to Host
      // 1. Down-link child match
      for (const sid in slots) {
        if (slots[sid].clientInfo && slots[sid].clientInfo.peerId === targetPeerId) {
          if (slots[sid].dc && slots[sid].dc.readyState === 'open') {
            sendDirectMessage(slots[sid].dc, payload);
            return;
          }
        }
      }
      // 2. Otherwise forward up-link to Host as proxy wrapper
      sendToHost({
        type: 'proxy-message',
        targetPeerId: targetPeerId,
        payload: payload
      });
    }
  }

  // Sends messages to direct neighbors (split horizon)
  function broadcastMessage(payload, excludeSlotId) {
    if (!payload.msgId) {
      payload.msgId = myPeerId + "_" + (++messageSeq);
    }
    seenMessages.add(payload.msgId);

    // If client, we also inject sender details so proxy routing works
    if (!isHost && !payload.senderId) {
      payload.senderId = myPeerId;
    }

    for (const sid in slots) {
      if (sid !== excludeSlotId && slots[sid].dc && slots[sid].dc.readyState === 'open') {
        sendDirectMessage(slots[sid].dc, payload);
      }
    }
  }

  // Relays changes from Host to all connected clients
  function relayMessageToAll(payload, excludeSenderId) {
    if (!payload.msgId) {
      payload.msgId = myPeerId + "_" + (++messageSeq);
    }
    seenMessages.add(payload.msgId);
    
    activePlayers.forEach(p => {
      if (p.playerId !== myPeerId && p.playerId !== excludeSenderId) {
        sendToPeer(p.playerId, payload);
      }
    });
  }

  function sendDirectMessage(channel, payload) {
    if (channel && channel.readyState === 'open') {
      try {
        channel.send(JSON.stringify(payload));
      } catch (e) {
        console.error('[P2P Send] Write error:', e);
      }
    }
  }

  // Player Registration
  function registerActivePlayer(playerInfo) {
    const exists = activePlayers.some(p => p.playerId === playerInfo.playerId);
    if (!exists) {
      activePlayers.push(playerInfo);
    } else {
      activePlayers = activePlayers.map(p => p.playerId === playerInfo.playerId ? playerInfo : p);
    }
  }

  function broadcastPlayersList() {
    relayMessageToAll({
      type: 'players-sync',
      players: activePlayers
    });
  }

  // Slot Disconnection Teardown & Failover Routing
  function handleSlotClosed(slotId) {
    const slot = slots[slotId];
    if (!slot) return;
    
    console.log(`[P2P Teardown][${slotId}] Cleaning connection resources.`);
    try { slot.dc.close(); } catch(e) {}
    try { slot.pc.close(); } catch(e) {}

    const disconnectedPeerId = slot.clientInfo ? slot.clientInfo.peerId : null;
    delete slots[slotId];

    if (isHost) {
      if (disconnectedPeerId) {
        // Clean direct active player
        activePlayers = activePlayers.filter(p => p.playerId !== disconnectedPeerId);
        
        // Clean downstream proxied connections of this peer
        for (const pid in proxiedPeers) {
          if (proxiedPeers[pid] === disconnectedPeerId) {
            activePlayers = activePlayers.filter(p => p.playerId !== pid);
            delete proxiedPeers[pid];
          }
        }
        broadcastPlayersList();
      }
      updateUIStatus(Object.keys(slots).length > 0 ? 'connected' : 'disconnected');
    } else {
      // If we are a Client, check if this was our route to the Host
      if (slotId === primaryRouteSlotId) {
        primaryRouteSlotId = null;
        
        // FAILOVER: Scan if we have another active connection slot (e.g. backup link)
        console.log('[P2P Failover] Primary route lost! Searching backup paths...');
        for (const sid in slots) {
          if (slots[sid].status === 'connected' && slots[sid].dc && slots[sid].dc.readyState === 'open') {
            primaryRouteSlotId = sid;
            console.log(`[P2P Failover] Route re-routed through backup slot: ${sid}`);
            break;
          }
        }
      } else {
        // If we are Client and this was a downstream connection slot
        if (disconnectedPeerId && slotId !== 'parent_slot') {
          console.log(`[P2P Proxy] Downstream client ${disconnectedPeerId} disconnected. Deregistering from Host.`);
          sendToHost({
            type: 'proxy-deregister',
            peerId: disconnectedPeerId
          });
        }
      }

      const hasHostRoute = primaryRouteSlotId !== null;
      updateUIStatus(hasHostRoute ? 'connected' : 'disconnected');
    }
  }

  // Periodic Keepalive Heatbeats
  setInterval(() => {
    broadcastMessage({ type: 'heartbeat' });
  }, 5000);

  // cleanup whole local engine
  function cleanup() {
    console.log('[P2P Connection] Terminating all mesh links...');
    for (const sid in slots) {
      try { slots[sid].dc.close(); } catch(e) {}
      try { slots[sid].pc.close(); } catch(e) {}
    }
    slots = {};
    proxiedPeers = {};
    primaryRouteSlotId = null;
    document.querySelectorAll('[class^="peer-highlight-"]').forEach(el => el.remove());
    updateUIStatus('disconnected');
  }
  window.p2pCleanup = cleanup;

  // Binds triggers from sudoku app.js
  window.addEventListener('sudoku:p2pSendMove', (e) => {
    const payload = {
      type: 'move',
      cellIndex: e.detail.cellIndex,
      value: e.detail.value,
      grid: e.detail.grid,
      status: e.detail.status
    };
    if (isHost) {
      relayMessageToAll(payload, myPeerId);
    } else {
      sendToHost(payload);
    }
  });

  window.addEventListener('sudoku:p2pSendSolve', (e) => {
    const payload = {
      type: 'solve',
      grid: e.detail.grid,
      status: e.detail.status
    };
    if (isHost) {
      relayMessageToAll(payload, myPeerId);
    } else {
      sendToHost(payload);
    }
  });

  window.addEventListener('sudoku:p2pSendFocus', (e) => {
    const payload = {
      type: 'focus',
      cellIndex: e.detail.cellIndex,
      color: myColor,
      nickname: myNickname
    };
    if (isHost) {
      relayMessageToAll(payload, myPeerId);
    } else {
      sendToHost(payload);
    }
  });

  window.addEventListener('sudoku:p2pSyncRequested', (e) => {
    const payload = {
      type: 'state-sync',
      initialGrid: e.detail.initialGrid,
      currentGrid: e.detail.currentGrid,
      status: e.detail.status
    };
    if (e.detail.recipientId === 'host') {
      sendToHost(payload);
    } else {
      sendToPeer(e.detail.recipientId, payload);
    }
  });

  window.addEventListener('sudoku:submitManualToken', (e) => {
    applyManualToken(e.detail.token, e.detail.slotId);
  });

  window.addEventListener('sudoku:triggerManualOffer', (e) => {
    setupWebRTC(e.detail.slotId);
  });

  // Client startup check
  if (hasOfferInHash) {
    console.log('[P2P Setup] Offer found in URL hash. Starting Client setup...');
    setTimeout(() => {
      try {
        const decoded = JSON.parse(atob(hashParams.offer));
        setupWebRTC('parent_slot', decoded);
      } catch (err) {
        console.error('[P2P Setup] Failed to decode hash offer:', err);
      }
    }, 100);
  } else {
    console.log('[P2P Setup] Ready to host. Add slot and copy URL to invite players.');
    // Pre-generate slot_1 invite link on Host startup to save manual connection setup time
    setTimeout(() => {
      setupWebRTC('slot_1');
    }, 500);
  }

})();
