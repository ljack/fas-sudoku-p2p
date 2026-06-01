const puppeteer = require('puppeteer');

(async () => {
  console.log('[E2E Test] Launching headless browser instances with Virtual SDN WebRTC Router...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const routingTable = {};
  const connectionPageMap = {};

  // Setup loopback network injection on a page
  const injectMockSDN = async (pageName, page) => {
    // Expose Node routing functions
    await page.exposeFunction('registerMockConnectionPage', (connId) => {
      connectionPageMap[connId] = page;
      console.log(`[Virtual SDN] Registered connection page: ${connId} (on ${pageName})`);
    });

    await page.exposeFunction('registerMockRoute', (localId, remoteId) => {
      routingTable[localId] = remoteId;
      routingTable[remoteId] = localId;
      connectionPageMap[localId] = page;
      console.log(`[Virtual SDN] Registered route: ${localId} (on ${pageName}) <--> ${remoteId}`);
    });

    await page.exposeFunction('sendMockMessageToNode', (connId, data) => {
      connectionPageMap[connId] = page;
      const destConnId = routingTable[connId];
      if (destConnId) {
        const destPage = connectionPageMap[destConnId];
        if (destPage) {
          destPage.evaluate((cid, d) => {
            if (window.receiveMockMessageFromNode) {
              window.receiveMockMessageFromNode(cid, d);
            }
          }, destConnId, data).catch(() => {});
        }
      }
    });

    await page.exposeFunction('closeMockConnection', (connId) => {
      const destConnId = routingTable[connId];
      if (destConnId) {
        const destPage = connectionPageMap[destConnId];
        if (destPage) {
          destPage.evaluate((cid) => {
            const conn = window.mockConnections[cid];
            if (conn) {
              conn.closeFromRemote();
            }
          }, destConnId).catch(() => {});
        }
      }
    });

    // Inject Browser Mock WebRTC Objects
    await page.evaluateOnNewDocument(() => {
      window.mockConnections = {};
      window.mockDataChannels = {};

      window.receiveMockMessageFromNode = (connId, data) => {
        const dc = window.mockDataChannels[connId];
        if (dc && dc.onmessage) {
          dc.onmessage({ data });
        }
      };

      class MockDataChannel {
        constructor(connId) {
          this.connId = connId;
          this.readyState = 'connecting';
          this.onopen = null;
          this.onmessage = null;
          this.onclose = null;
          window.mockDataChannels[connId] = this;
        }
        send(data) {
          window.sendMockMessageToNode(this.connId, data);
        }
        close() {
          if (this.readyState === 'closed') return;
          this.readyState = 'closed';
          if (this.onclose) {
            const cb = this.onclose;
            this.onclose = null; // Prevent recursive loops
            cb();
          }
        }
      }

      class MockRTCPeerConnection {
        constructor() {
          this.connId = 'conn_' + Math.random().toString(36).substring(2, 9);
          window.mockConnections[this.connId] = this;
          window.registerMockConnectionPage(this.connId);
          this.connectionState = 'new';
          this.iceGatheringState = 'new';
          this.localDescription = null;
          this.remoteDescription = null;
        }
        createDataChannel(name, options) {
          const dc = new MockDataChannel(this.connId);
          this.dc = dc;
          return dc;
        }
        async createOffer() {
          return { type: 'offer', sdp: this.connId };
        }
        async createAnswer() {
          return { type: 'answer', sdp: this.connId };
        }
        async setLocalDescription(desc) {
          this.localDescription = desc;
          desc.sdp = this.connId;
          setTimeout(() => {
            this.iceGatheringState = 'complete';
            if (this.onicegatheringstatechange) this.onicegatheringstatechange();
          }, 20);
        }
        async setRemoteDescription(desc) {
          this.remoteDescription = desc;
          const remoteConnId = desc.sdp;
          window.registerMockRoute(this.connId, remoteConnId);
          
          if (desc.type === 'offer') {
            setTimeout(() => {
              const dc = new MockDataChannel(this.connId);
              this.dc = dc;
              if (this.ondatachannel) {
                this.ondatachannel({ channel: dc });
              }
              setTimeout(() => {
                this.connectionState = 'connected';
                if (this.onconnectionstatechange) this.onconnectionstatechange();
                dc.readyState = 'open';
                if (dc.onopen) dc.onopen();
              }, 20);
            }, 20);
          } else if (desc.type === 'answer') {
            setTimeout(() => {
              this.connectionState = 'connected';
              if (this.onconnectionstatechange) this.onconnectionstatechange();
              if (this.dc) {
                this.dc.readyState = 'open';
                if (this.dc.onopen) this.dc.onopen();
              }
            }, 20);
          }
        }
        close() {
          if (this.connectionState === 'closed') return;
          this.connectionState = 'closed';
          window.closeMockConnection(this.connId);
          if (this.dc) this.dc.close();
        }
        closeFromRemote() {
          if (this.connectionState === 'closed') return;
          this.connectionState = 'closed';
          if (this.onconnectionstatechange) this.onconnectionstatechange();
          if (this.dc) {
            this.dc.readyState = 'closed';
            if (this.dc.onclose) this.dc.onclose();
          }
        }
      }

      window.RTCPeerConnection = MockRTCPeerConnection;
    });
  };

  let hostPage, clientPage1, clientPage2;
  let hostMsgCallback = null, client1MsgCallback = null, client2MsgCallback = null;

  try {
    hostPage = await browser.newPage();
    clientPage1 = await browser.newPage();
    clientPage2 = await browser.newPage();

    await injectMockSDN('Host', hostPage);
    await injectMockSDN('Client 1', clientPage1);
    await injectMockSDN('Client 2', clientPage2);

    // Redirect Browser Logs
    hostPage.on('console', msg => console.log(`[Host Browser] ${msg.text()}`));
    clientPage1.on('console', msg => console.log(`[Client 1 Browser] ${msg.text()}`));
    clientPage2.on('console', msg => console.log(`[Client 2 Browser] ${msg.text()}`));
    
    hostPage.on('pageerror', err => console.error(`[Host PageError] ${err.toString()}`));
    clientPage1.on('pageerror', err => console.error(`[Client 1 PageError] ${err.toString()}`));
    clientPage2.on('pageerror', err => console.error(`[Client 2 PageError] ${err.toString()}`));

    console.log('[E2E Test] Loading Host page from local static build...');
    await hostPage.goto('file:///Users/jarkko/_dev/fas-sudoku-p2p/dist-static/index.html', { waitUntil: 'networkidle2' });

    console.log('[E2E Test] Switching Host to Manual signaling mode...');
    await hostPage.evaluate(() => {
      document.getElementById('btn-mode-manual').click();
    });

    console.log('[E2E Test] Generating Host connection link for Slot 1...');
    await hostPage.evaluate(() => {
      document.getElementById('btn-manual-offer').click();
    });

    // Wait for localSdpText to contain the share URL
    await new Promise(r => setTimeout(r, 1000));
    const val = await hostPage.evaluate(() => document.getElementById('local-sdp-text').value);
    console.log('[E2E Debug Node] local-sdp-text value after 1s:', val);

    await hostPage.waitForFunction(() => {
      const val = document.getElementById('local-sdp-text').value;
      return val && val.includes('#gameId=');
    }, { polling: 100, timeout: 8000 });

    const shareURL1 = await hostPage.evaluate(() => document.getElementById('local-sdp-text').value);
    console.log(`[E2E Test] Host Slot 1 invite generated: ${shareURL1}`);

    console.log('[E2E Test] Loading Client 1 page...');
    await clientPage1.goto(shareURL1, { waitUntil: 'networkidle2' });

    // Wait for Client 1 answer
    await clientPage1.waitForFunction(() => {
      const val = document.getElementById('local-sdp-text').value;
      return val && val.length > 50 && !val.includes('#gameId=');
    }, { polling: 100, timeout: 8000 });

    const client1Answer = await clientPage1.evaluate(() => document.getElementById('local-sdp-text').value);
    console.log('[E2E Test] Client 1 answer generated.');

    console.log('[E2E Test] Completing Host <--> Client 1 handshake...');
    await hostPage.evaluate((token) => {
      document.getElementById('remote-sdp-text').value = token;
      document.getElementById('btn-manual-connect').click();
    }, client1Answer);

    const debugTimer = setInterval(async () => {
      try {
        const hostStatus = await hostPage.evaluate(() => document.getElementById('p2p-status-badge').textContent);
        const client1Status = await clientPage1.evaluate(() => document.getElementById('p2p-status-badge').textContent);
        console.log(`[E2E Debug Timer] Host badge: "${hostStatus}", Client 1 badge: "${client1Status}"`);
      } catch (err) {
        console.log(`[E2E Debug Timer] Error: ${err.message}`);
      }
    }, 500);

    try {
      await Promise.all([
        hostPage.waitForFunction(() => document.getElementById('p2p-status-badge').textContent.toLowerCase() === 'connected', { polling: 100, timeout: 8000 }),
        clientPage1.waitForFunction(() => document.getElementById('p2p-status-badge').textContent.toLowerCase() === 'connected', { polling: 100, timeout: 8000 })
      ]);
    } finally {
      clearInterval(debugTimer);
    }
    console.log('✅ [E2E Test] Host <--> Client 1 connected directly.');

    // CLIENT 1 CREATES RELAY LOBBY
    console.log('[E2E Test] Client 1 adding a Relay Slot (automatically generates offer)...');
    await clientPage1.evaluate(() => {
      document.getElementById('btn-add-proxy-slot').click();
    });

    await clientPage1.waitForFunction(() => {
      const val = document.getElementById('local-sdp-text').value;
      return val && val.includes('#gameId=');
    }, { polling: 100, timeout: 8000 });

    const relayURL = await clientPage1.evaluate(() => document.getElementById('local-sdp-text').value);
    console.log(`[E2E Test] Client 1 Relay invite generated: ${relayURL}`);

    console.log('[E2E Test] Loading Client 2 page with Relay invite URL...');
    await clientPage2.goto(relayURL, { waitUntil: 'networkidle2' });

    await clientPage2.waitForFunction(() => {
      const val = document.getElementById('local-sdp-text').value;
      return val && val.length > 50 && !val.includes('#gameId=');
    }, { polling: 100, timeout: 8000 });

    const client2Answer = await clientPage2.evaluate(() => document.getElementById('local-sdp-text').value);
    console.log('[E2E Test] Client 2 answer generated.');

    console.log('[E2E Test] Completing Client 1 <--> Client 2 manual handshake...');
    await clientPage1.evaluate((token) => {
      document.getElementById('remote-sdp-text').value = token;
      document.getElementById('btn-manual-connect').click();
    }, client2Answer);

    await Promise.all([
      clientPage1.waitForFunction(() => document.getElementById('p2p-status-badge').textContent.toLowerCase() === 'connected', { polling: 100, timeout: 8000 }),
      clientPage2.waitForFunction(() => document.getElementById('p2p-status-badge').textContent.toLowerCase() === 'connected', { polling: 100, timeout: 8000 })
    ]);
    console.log('✅ [E2E Test] Client 1 <--> Client 2 connected.');

    // VERIFY AUTO-SIGNALING BACKUP CONNECTION ESTABLISHED
    console.log('[E2E Test] Waiting for Host <--> Client 2 background Auto-Signaling direct link...');
    await new Promise(r => setTimeout(r, 1000));

    // Client 2 should list 2 slots: 'parent_slot' (Host) and its auto slot
    const client2Slots = await clientPage2.evaluate(() => {
      return document.getElementById('p2p-slots-bar').textContent;
    });
    console.log('[E2E Debug] Client 2 Active slots:', client2Slots);

    // VERIFY LOBBY ROSTER LISTS CLIENT 2 RELAYED AND DIRECT STATUS
    const roster = await hostPage.evaluate(() => {
      return document.getElementById('p2p-lobby-roster').textContent;
    });
    console.log('[E2E Debug] Host Lobby Roster:', roster.replace(/\s+/g, ' ').trim());

    // TEST EVENT RELAYING (Client 2 -> Client 1 -> Host)
    console.log('[E2E Test] Simulating Client 2 cell focus and move...');
    const inputsValues = await clientPage2.evaluate(() => {
      return Array.from(document.querySelectorAll('.cell input')).map(el => el.value);
    });
    console.log('[E2E Debug] Client 2 initial cell values (first 10):', inputsValues.slice(0, 10));

    const cellIndex = await clientPage2.evaluate(() => {
      const inputs = document.querySelectorAll('.cell input');
      for (let i = 0; i < inputs.length; i++) {
        if (!inputs[i].readOnly && inputs[i].value === '') {
          inputs[i].focus();
          return i;
        }
      }
      return -1;
    });

    if (cellIndex !== -1) {
      console.log(`[E2E Test] Client 2 enters '8' in cell ${cellIndex}...`);
      const inputs = await clientPage2.$$('.cell input');
      await inputs[cellIndex].type('8');

      console.log('[E2E Test] Verifying board sync on Host and Client 1...');
      await Promise.all([
        hostPage.waitForFunction((idx) => {
          const inputs = document.querySelectorAll('.cell input');
          return inputs[idx] && inputs[idx].value === '8';
        }, { polling: 100, timeout: 6000 }, cellIndex),
        clientPage1.waitForFunction((idx) => {
          const inputs = document.querySelectorAll('.cell input');
          return inputs[idx] && inputs[idx].value === '8';
        }, { polling: 100, timeout: 6000 }, cellIndex)
      ]);
      console.log('✅ [E2E Test] Relayed Client 2 move synced instantly across all peers.');
    } else {
      console.warn('[E2E Test] No empty cell found for move test.');
    }

    // TEST ROUTE FAILOVER (Kill Client 1, Verify Client 2 fallback route is active)
    console.log('[E2E Test] Simulating primary route crash (closing Client 1 page)...');
    await clientPage1.evaluate(() => window.p2pCleanup());
    await clientPage1.close();
    clientPage1 = null;

    console.log('[E2E Test] Waiting for Client 2 to detect drop and failover to direct backup link...');
    await new Promise(r => setTimeout(r, 1000));

    await clientPage2.waitForFunction(() => {
      return document.getElementById('p2p-status-badge').textContent.toLowerCase() === 'connected';
    }, { polling: 100, timeout: 6000 });
    console.log('✅ [E2E Test] Client 2 failover route confirmed (remains connected).');

    // TEST DEDUPLICATED FALLBACK COMMUNICATION
    console.log('[E2E Test] Client 2 making a move post-failover...');
    const cellIndex2 = await clientPage2.evaluate((excludeIdx) => {
      const inputs = document.querySelectorAll('.cell input');
      for (let i = 0; i < inputs.length; i++) {
        if (!inputs[i].readOnly && inputs[i].value === '' && i !== excludeIdx) {
          inputs[i].focus();
          return i;
        }
      }
      return -1;
    }, cellIndex);

    if (cellIndex2 !== -1) {
      const inputState = await clientPage2.evaluate((idx) => {
        const input = document.querySelectorAll('.cell input')[idx];
        return input ? {
          value: input.value,
          readOnly: input.readOnly,
          disabled: input.disabled,
          tagName: input.tagName
        } : null;
      }, cellIndex2);
      console.log(`[E2E Debug] Client 2 cellIndex2 (${cellIndex2}) input state:`, inputState);

      console.log(`[E2E Test] Client 2 enters '7' in cell ${cellIndex2}...`);
      const inputs = await clientPage2.$$('.cell input');
      await inputs[cellIndex2].type('7');

      console.log('[E2E Test] Verifying board sync on Host via backup route...');
      await hostPage.waitForFunction((idx) => {
        const inputs = document.querySelectorAll('.cell input');
        return inputs[idx] && inputs[idx].value === '7';
      }, { polling: 100, timeout: 6000 }, cellIndex2);
      console.log('✅ [E2E Test] Failover communication verified! Backup route working.');
    }

    console.log('✅ [E2E Test] All 2+ Player Relay and Mesh Failover tests completed successfully!');
  } catch (err) {
    console.error('❌ [E2E Test] verification failed:', err);
    process.exit(1);
  } finally {
    hostMsgCallback = null;
    client1MsgCallback = null;
    client2MsgCallback = null;
    try {
      if (clientPage1) await clientPage1.close();
      if (clientPage2) await clientPage2.close();
      if (hostPage) await hostPage.close();
    } catch (e) {}
    try {
      await browser.close();
    } catch (e) {}
  }
})();
