// ===================================
// INJECTED SCRIPT - Chạy trong page context
// ===================================

(async function () {
    console.log('🚀 Starting Captcha Client...');

    const CONFIG = {
        projectId: '26685d88-6680-4f20-b9f4-894a1340f3a5',
        siteKey: '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV',
        socketServer: 'http://localhost:3000', // URL NestJS server
        action: 'FLOW_GENERATION'
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
    async function solveCaptcha() {
        try {
            console.log('🔐 Executing reCAPTCHA...');
            sendLog('Executing reCAPTCHA...');

            const token = await window.grecaptcha.enterprise.execute(
                CONFIG.siteKey,
                { action: CONFIG.action }
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
                const token = await solveCaptcha();

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
