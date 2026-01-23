// ===================================
// INJECTED SCRIPT - Chạy trong page context
// ===================================

(async function () {
    console.log('🚀 Starting Captcha Client...');

    const CONFIG = {
        siteKey: '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV',
        socketServer: 'http://localhost:3000', // URL NestJS server
    };

    // Helper để gửi log về content script
    function sendLog(message) {
        window.postMessage({
            type: 'CAPTCHA_LOG',
            message: message
        }, '*');
    }

    // Helper để gửi status update
    function sendStatus(status, data = {}) {
        window.postMessage({
            type: 'CAPTCHA_STATUS',
            data: { status, ...data }
        }, '*');
    }

    // Tạo CSS cho countdown badge
    function createCountdownStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #countdown-badge {
                position: fixed;
                bottom: 28px;
                right: 28px;
                min-width: 156px;
                height: 88px;
                border-radius: 12px;
                background: linear-gradient(135deg, #5b7cfa 0%, #748ffc 100%);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
                color: white;
                box-shadow: 0 10px 32px rgba(91, 124, 250, 0.35),
                            inset 0 1px 2px rgba(255, 255, 255, 0.3);
                z-index: 999999;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                opacity: 0.97;
                cursor: default;
                padding: 14px 16px;
                gap: 6px;
                backdrop-filter: blur(8px);
                border: 1px solid rgba(255, 255, 255, 0.2);
            }

            #countdown-badge:hover {
                transform: translateY(-3px);
                opacity: 1;
                box-shadow: 0 14px 40px rgba(91, 124, 250, 0.45),
                            inset 0 1px 2px rgba(255, 255, 255, 0.3);
            }

            #countdown-badge.hidden {
                display: none;
            }

            #countdown-badge-label {
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.8px;
                opacity: 0.85;
                white-space: nowrap;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
            }

            #countdown-badge-time {
                font-size: 36px;
                font-weight: 700;
                text-align: center;
                line-height: 1;
                font-variant-numeric: tabular-nums;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
                letter-spacing: -1px;
            }

            #countdown-badge-progress {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                border-radius: 12px;
                background: linear-gradient(135deg, 
                    rgba(91, 124, 250, 0.15) 0%,
                    rgba(116, 143, 252, 0.15) 100%);
                opacity: 0.5;
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }

    // Tạo countdown badge element
    function createCountdownBadge() {
        if (document.getElementById('countdown-badge')) {
            return;
        }

        const badge = document.createElement('div');
        badge.id = 'countdown-badge';
        badge.className = 'hidden';
        badge.innerHTML = `
            <div id="countdown-badge-progress"></div>
            <div id="countdown-badge-label">Before Reload</div>
            <div id="countdown-badge-time">--</div>
        `;
        document.body.appendChild(badge);
    }

    // Update countdown badge
    function updateCountdownBadge(remainingSeconds, totalSeconds) {
        const badge = document.getElementById('countdown-badge');
        if (!badge) return;

        if (remainingSeconds <= 0) {
            badge.classList.add('hidden');
            return;
        }

        badge.classList.remove('hidden');

        const timeElement = document.querySelector('#countdown-badge-time');
        const seconds = Math.max(0, remainingSeconds);
        timeElement.textContent = String(seconds).padStart(2, '0') + 's';

        // Color gradient: blue -> orange -> red
        let bgColor;
        const percentage = remainingSeconds / totalSeconds;

        if (percentage > 0.6) {
            // Xanh dương - sắp sửa reload
            bgColor = 'linear-gradient(135deg, #5b7cfa 0%, #748ffc 100%)';
        } else if (percentage > 0.3) {
            // Cam - cảnh báo
            bgColor = 'linear-gradient(135deg, #ffa500 0%, #ff8c00 100%)';
        } else {
            // Đỏ - gần reload ngay
            bgColor = 'linear-gradient(135deg, #ff4757 0%, #ff3838 100%)';
        }
        badge.style.background = bgColor;
    }

    // Load Socket.IO
    function loadSocketIO() {
        return new Promise((resolve, reject) => {
            if (window.io) {
                resolve(window.io);
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
            script.onload = () => resolve(window.io);
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Chờ grecaptcha load
    async function waitForRecaptcha() {
        console.log('⏳ Waiting for reCAPTCHA...');
        sendLog('Waiting for reCAPTCHA...');

        const maxAttempts = 60;
        for (let i = 0; i < maxAttempts; i++) {
            if (window.grecaptcha?.enterprise?.execute) {
                console.log('✅ reCAPTCHA ready!');
                sendLog('reCAPTCHA ready!');
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        throw new Error('reCAPTCHA not loaded after 30s');
    }

    // Solve captcha
    async function solveCaptcha(action = 'VIDEO_GENERATION') {
        try {
            console.log('🔐 Executing reCAPTCHA...');
            sendLog('Executing reCAPTCHA...');

            const token = await window.grecaptcha.enterprise.execute(
                CONFIG.siteKey,
                { action: action }
            );

            console.log('✅ Token obtained:', token.substring(0, 50) + '...');
            sendLog('Token obtained: ' + token.substring(0, 50) + '...');
            sendStatus('token_obtained', { tokenLength: token.length });

            return token;
        } catch (error) {
            console.error('❌ Captcha error:', error);
            sendLog('Captcha error: ' + error.message);
            sendStatus('error', { error: error.message });
            throw error;
        }
    }

    try {
        // Tạo countdown badge styles
        createCountdownStyles();

        // Tạo countdown badge element
        createCountdownBadge();

        // Lắng nghe countdown updates từ content script
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;

            if (event.data.type === 'COUNTDOWN_UPDATE') {
                updateCountdownBadge(event.data.remainingSeconds, event.data.totalSeconds);
            }
        });

        // Load Socket.IO
        console.log('📡 Loading Socket.IO...');
        sendLog('Loading Socket.IO...');
        const io = await loadSocketIO();

        // Connect to server
        console.log('🔌 Connecting to server...');
        sendLog('Connecting to server...');
        const socket = io(CONFIG.socketServer, {
            transports: ['websocket', 'polling'],
            autoConnect: true
        });

        socket.on('connect', () => {
            console.log('✅ Connected to server! Socket ID:', socket.id);
            sendLog('Connected to server! Socket ID: ' + socket.id);
            sendStatus('connected', { socketId: socket.id });

            socket.emit('client:ready', {
                projectId: CONFIG.projectId,
                timestamp: new Date().toISOString()
            });
        });

        socket.on('disconnect', () => {
            console.log('❌ Disconnected from server');
            sendLog('Disconnected from server');
            sendStatus('disconnected');
        });

        socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            sendLog('Connection error: ' + error.message);
            sendStatus('connection_error', { error: error.message });
        });

        // Lắng nghe yêu cầu solve captcha từ server
        socket.on('server:request-captcha', async (data) => {
            console.log('📨 Received captcha request:', data);
            sendLog('Received captcha request');

            try {
                const action = data?.action || 'VIDEO_GENERATION';

                const token = await solveCaptcha(action);

                socket.emit('client:captcha-solved', {
                    requestId: data?.requestId,
                    token,
                    timestamp: new Date().toISOString()
                });

                console.log('📤 Sent token to server');
                sendLog('Sent token to server');
            } catch (error) {
                socket.emit('client:captcha-error', {
                    requestId: data?.requestId,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
                console.error('Failed to solve captcha:', error);
                sendLog('Failed to solve captcha: ' + error.message);
            }
        });

        // Lắng nghe yêu cầu reload page từ server
        socket.on('server:reload-page', (data) => {
            console.log('🔄 Received reload page request:', data);
            sendLog('Server requested page reload');
            sendStatus('reload_requested', { delay: data?.delay || 0 });

            const delay = data?.delay || 0;

            // Clear localStorage trước khi reload
            localStorage.removeItem('_grecaptcha');
            console.log('🗑️ Cleared _grecaptcha from localStorage');

            if (delay > 0) {
                console.log(`⏳ Reloading in ${delay}ms...`);
                sendLog(`Reloading in ${delay}ms...`);
                setTimeout(() => {
                    window.location.reload();
                }, delay);
            } else {
                window.location.reload();
            }
        });

        // Wait for reCAPTCHA
        await waitForRecaptcha();

        // Test solve captcha ngay
        console.log('🧪 Testing captcha solve...');
        sendLog('Testing captcha solve...');
        const testToken = await solveCaptcha();
        console.log('✅ Test successful! Token length:', testToken.length);
        sendLog('Test successful! Token length: ' + testToken.length);

        // Expose utilities
        window.captchaClient = {
            socket,
            solveCaptcha,
            config: CONFIG,

            // Manual solve và gửi lên server
            solveAndSend: async () => {
                try {
                    const token = await solveCaptcha();
                    socket.emit('client:captcha-manual', {
                        token,
                        timestamp: new Date().toISOString()
                    });
                    return token;
                } catch (error) {
                    console.error('Error:', error);
                    throw error;
                }
            },

            // Manual reload page
            reloadPage: (delay = 0) => {
                console.log(`🔄 Reloading page${delay ? ` in ${delay}ms` : ''}...`);
                sendLog(`Reloading page${delay ? ` in ${delay}ms` : ''}...`);

                // Clear localStorage trước khi reload
                localStorage.removeItem('_grecaptcha');
                console.log('🗑️ Cleared _grecaptcha from localStorage');

                if (delay > 0) {
                    setTimeout(() => window.location.reload(), delay);
                } else {
                    window.location.reload();
                }
            }
        };

        console.log('🎉 Captcha Client Ready!');
        console.log('💡 Available commands:');
        console.log('  - captchaClient.solveAndSend() // Solve và gửi manual');
        console.log('  - captchaClient.reloadPage(delay?) // Reload page với delay (ms)');
        console.log('  - captchaClient.socket // Access socket trực tiếp');

        sendLog('Captcha Client Ready!');
        sendStatus('ready');

    } catch (error) {
        console.error('❌ Initialization failed:', error);
        sendLog('Initialization failed: ' + error.message);
        sendStatus('init_failed', { error: error.message });
    }
})();
