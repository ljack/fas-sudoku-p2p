const puppeteer = require('puppeteer');

(async () => {
  console.log('[E2E Test] Launching headless browser instances with Virtual WebRTC Bridging...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const hostPage = await browser.newPage();
    const clientPage = await browser.newPage();

    // Set up Virtual Loopback Bridge via Node.js
    let hostMsgCallback = null;
    let clientMsgCallback = null;

    await hostPage.exposeFunction('sendMockMessageToNode', (data) => {
      if (clientMsgCallback) clientMsgCallback(data);
    });

    await clientPage.exposeFunction('sendMockMessageToNode', (data) => {
      if (hostMsgCallback) hostMsgCallback(data);
    });

    hostMsgCallback = (data) => {
      hostPage.evaluate((d) => {
        if (window.receiveMockMessageFromNode) window.receiveMockMessageFromNode(d);
      }, data).catch(() => {});
    };

    clientMsgCallback = (data) => {
      clientPage.evaluate((d) => {
        if (window.receiveMockMessageFromNode) window.receiveMockMessageFromNode(d);
      }, data).catch(() => {});
    };

    // Inject Mock WebRTC on Host
    await hostPage.evaluateOnNewDocument(() => {
      class MockDataChannel {
        constructor() {
          this.readyState = 'connecting';
          this.onopen = null;
          this.onmessage = null;
          this.onclose = null;
          window.mockDataChannelInstance = this;
        }
        send(data) {
          window.sendMockMessageToNode(data);
        }
      }

      class MockRTCPeerConnection {
        constructor() {
          this.connectionState = 'new';
          this.iceGatheringState = 'new';
          this.localDescription = null;
          this.remoteDescription = null;
        }
        createDataChannel() {
          return new MockDataChannel();
        }
        async createOffer() {
          return { type: 'offer', sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 AA:BB...' };
        }
        async setLocalDescription(desc) {
          this.localDescription = desc;
          setTimeout(() => {
            this.iceGatheringState = 'complete';
            if (this.onicegatheringstatechange) this.onicegatheringstatechange();
          }, 50);
        }
        async setRemoteDescription(desc) {
          this.remoteDescription = desc;
          if (desc.type === 'answer') {
            setTimeout(() => {
              this.connectionState = 'connected';
              if (this.onconnectionstatechange) this.onconnectionstatechange();
              if (window.mockDataChannelInstance) {
                window.mockDataChannelInstance.readyState = 'open';
                if (window.mockDataChannelInstance.onopen) window.mockDataChannelInstance.onopen();
              }
            }, 50);
          }
        }
      }

      window.RTCPeerConnection = MockRTCPeerConnection;
      window.receiveMockMessageFromNode = (data) => {
        if (window.mockDataChannelInstance && window.mockDataChannelInstance.onmessage) {
          window.mockDataChannelInstance.onmessage({ data });
        }
      };
    });

    // Inject Mock WebRTC on Client
    await clientPage.evaluateOnNewDocument(() => {
      class MockDataChannel {
        constructor() {
          this.readyState = 'connecting';
          this.onopen = null;
          this.onmessage = null;
          this.onclose = null;
          window.mockDataChannelInstance = this;
        }
        send(data) {
          window.sendMockMessageToNode(data);
        }
      }

      class MockRTCPeerConnection {
        constructor() {
          this.connectionState = 'new';
          this.iceGatheringState = 'new';
          this.localDescription = null;
          this.remoteDescription = null;
        }
        async createAnswer() {
          return { type: 'answer', sdp: 'v=0\r\no=- 54321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=fingerprint:sha-256 CC:DD...' };
        }
        async setLocalDescription(desc) {
          this.localDescription = desc;
          setTimeout(() => {
            this.iceGatheringState = 'complete';
            if (this.onicegatheringstatechange) this.onicegatheringstatechange();
          }, 50);
        }
        async setRemoteDescription(desc) {
          this.remoteDescription = desc;
          setTimeout(() => {
            const dc = new MockDataChannel();
            if (this.ondatachannel) {
              this.ondatachannel({ channel: dc });
            }
            setTimeout(() => {
              this.connectionState = 'connected';
              if (this.onconnectionstatechange) this.onconnectionstatechange();
              if (window.mockDataChannelInstance) {
                window.mockDataChannelInstance.readyState = 'open';
                if (window.mockDataChannelInstance.onopen) window.mockDataChannelInstance.onopen();
              }
            }, 50);
          }, 50);
        }
      }

      window.RTCPeerConnection = MockRTCPeerConnection;
      window.receiveMockMessageFromNode = (data) => {
        if (window.mockDataChannelInstance && window.mockDataChannelInstance.onmessage) {
          window.mockDataChannelInstance.onmessage({ data });
        }
      };
    });

    // Console Logging redirection & Page Errors / Failed Requests
    hostPage.on('console', msg => console.log(`[Host Browser] ${msg.text()}`));
    clientPage.on('console', msg => console.log(`[Client Browser] ${msg.text()}`));
    hostPage.on('pageerror', err => console.error(`[Host Browser PageError] ${err.toString()}`));
    clientPage.on('pageerror', err => console.error(`[Client Browser PageError] ${err.toString()}`));
    hostPage.on('requestfailed', req => console.error(`[Host Page Req Failed] ${req.url()} - ${req.failure() ? req.failure().errorText : 'unknown'}`));
    clientPage.on('requestfailed', req => console.error(`[Client Page Req Failed] ${req.url()} - ${req.failure() ? req.failure().errorText : 'unknown'}`));
    hostPage.on('response', res => {
      if (res.status() >= 400) console.error(`[Host Page HTTP Err] ${res.url()} - status ${res.status()}`);
    });
    clientPage.on('response', res => {
      if (res.status() >= 400) console.error(`[Client Page HTTP Err] ${res.url()} - status ${res.status()}`);
    });

    console.log('[E2E Test] Loading Host page on GitHub Pages...');
    await hostPage.goto('https://ljack.github.io/fas-sudoku-p2p/', { waitUntil: 'networkidle2' });

    console.log('[E2E Test] Switching Host to Manual signaling mode...');
    await hostPage.evaluate(() => {
      document.getElementById('btn-mode-manual').click();
    });

    console.log('[E2E Test] Generating Host connection link...');
    await hostPage.evaluate(() => {
      document.getElementById('btn-manual-offer').click();
    });

    // Wait for localSdpText to contain the share URL
    await new Promise(r => setTimeout(r, 1000));
    const debugInfo = await hostPage.evaluate(() => {
      return {
        localSdpVal: document.getElementById('local-sdp-text').value,
        statusText: document.getElementById('p2p-status-badge').textContent,
        logs: document.getElementById('diagnostic-logs').textContent
      };
    });
    console.log('[E2E Debug] Host Page state:', debugInfo);

    await hostPage.waitForFunction(() => {
      const val = document.getElementById('local-sdp-text').value;
      return val && val.startsWith('http');
    }, { timeout: 8000 });

    const shareURL = await hostPage.evaluate(() => document.getElementById('local-sdp-text').value);
    console.log(`[E2E Test] Share URL generated: ${shareURL}`);

    console.log('[E2E Test] Loading Client page with parsed hash parameters...');
    await clientPage.goto(shareURL, { waitUntil: 'networkidle2' });

    // Wait for client to generate answer token
    await clientPage.waitForFunction(() => {
      const val = document.getElementById('local-sdp-text').value;
      return val && val.length > 50 && !val.startsWith('http');
    }, { timeout: 8000 });

    const answerToken = await clientPage.evaluate(() => document.getElementById('local-sdp-text').value);
    console.log(`[E2E Test] Client Answer token generated.`);

    console.log('[E2E Test] Applying Client answer token on Host connection input...');
    await hostPage.evaluate((token) => {
      document.getElementById('remote-sdp-text').value = token;
    }, answerToken);

    console.log('[E2E Test] Clicking Host connect button...');
    await hostPage.evaluate(() => {
      document.getElementById('btn-manual-connect').click();
    });

    console.log('[E2E Test] Awaiting connection badge status synchronization...');
    await new Promise(r => setTimeout(r, 2000));
    const finalDebug = await Promise.all([
      hostPage.evaluate(() => ({
        badgeText: document.getElementById('p2p-status-badge').textContent,
        logs: document.getElementById('diagnostic-logs').textContent
      })),
      clientPage.evaluate(() => ({
        badgeText: document.getElementById('p2p-status-badge').textContent,
        logs: document.getElementById('diagnostic-logs').textContent
      }))
    ]);
    console.log('[E2E Debug] Host Badge & Logs:', finalDebug[0]);
    console.log('[E2E Debug] Client Badge & Logs:', finalDebug[1]);

    await Promise.all([
      hostPage.waitForFunction(() => {
        return document.getElementById('p2p-status-badge').textContent.toLowerCase() === 'connected';
      }, { timeout: 10000 }),
      clientPage.waitForFunction(() => {
        return document.getElementById('p2p-status-badge').textContent.toLowerCase() === 'connected';
      }, { timeout: 10000 })
    ]);

    console.log('[E2E Test] P2P virtual connection established successfully!');

    // Simulate game move
    console.log('[E2E Test] Locating and editing cell in Client browser...');
    const cellIndex = await clientPage.evaluate(() => {
      const inputs = document.querySelectorAll('.cell input');
      for (let i = 0; i < inputs.length; i++) {
        if (inputs[i].value === '') {
          inputs[i].focus();
          return i;
        }
      }
      return -1;
    });

    if (cellIndex !== -1) {
      console.log(`[E2E Test] Client enters value '9' in cell ${cellIndex}...`);
      const inputs = await clientPage.$$('.cell input');
      await inputs[cellIndex].type('9');

      console.log('[E2E Test] Verifying board synchronizes on Host browser...');
      await hostPage.waitForFunction((idx) => {
        const inputs = document.querySelectorAll('.cell input');
        return inputs[idx] && inputs[idx].value === '9';
      }, { timeout: 5000 }, cellIndex);

      console.log('[E2E Test] Board synchronization verified! Move synced instantly.');
    } else {
      console.warn('[E2E Test] No user input cell found.');
    }

    console.log('✅ [E2E Test] P2P E2E Manual Handshake test successfully completed!');
  } catch (err) {
    console.error('❌ [E2E Test] E2E verification failed:', err);
    process.exit(1);
  } finally {
    hostMsgCallback = null;
    clientMsgCallback = null;
    try {
      await browser.close();
    } catch (e) {}
  }
})();
