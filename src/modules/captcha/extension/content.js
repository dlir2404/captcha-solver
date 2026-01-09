// ===================================
// CONTENT SCRIPT - Inject script vào page
// ===================================

(function() {
    console.log('🔧 Content Script: Initializing...');

    // Inject captcha client script vào page context
    function injectCaptchaScript() {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('injected.js');
        script.type = 'text/javascript';
        
        (document.head || document.documentElement).appendChild(script);
        
        script.onload = function() {
            console.log('✅ Content Script: Captcha client injected successfully');
            script.remove();
        };

        script.onerror = function() {
            console.error('❌ Content Script: Failed to inject captcha client');
        };
    }

    // Lắng nghe tin nhắn từ injected script
    window.addEventListener('message', function(event) {
        if (event.source !== window) return;
        
        // Nhận log từ injected script
        if (event.data.type === 'CAPTCHA_LOG') {
            console.log('📨 From Injected:', event.data.message);
        }
        
        // Nhận status update
        if (event.data.type === 'CAPTCHA_STATUS') {
            // Gửi status lên background script nếu cần
            chrome.runtime.sendMessage({
                type: 'CAPTCHA_STATUS_UPDATE',
                data: event.data.data
            });
        }
    });

    // Lắng nghe tin nhắn từ background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'GET_PAGE_INFO') {
            sendResponse({
                url: window.location.href,
                title: document.title
            });
        }

        if (request.type === 'RELOAD_PAGE') {
            console.log('🔄 Content Script: Reloading page...');
            window.location.reload();
        }
    });

    // Inject script khi DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectCaptchaScript);
    } else {
        injectCaptchaScript();
    }

    console.log('✅ Content Script: Ready');
})();