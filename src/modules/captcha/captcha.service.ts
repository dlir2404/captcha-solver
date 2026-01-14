import { Injectable, Logger } from '@nestjs/common';
import { chromium, Browser, BrowserContext } from 'playwright';

declare global {
  interface Window {
    grecaptcha: {
      enterprise: {
        execute: (siteKey: string, options: any) => Promise<string>;
      };
    };
  }
}

@Injectable()
export class CaptchaService {
  private logger = new Logger(CaptchaService.name);

  async initBrowser(): Promise<Browser> {
    try {
      this.logger.log('🚀 Initializing Playwright browser instance...');

      const launchOptions: any = {
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
        ],
      };

      if (process.env.NODE_ENV === 'production') {
        const chromePaths = [
          process.env.CHROME_EXECUTABLE_PATH,
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ].filter(Boolean);

        launchOptions.executablePath = chromePaths[0];
        launchOptions.args.push(
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--no-first-run',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-background-networking',
          '--disable-sync',
          '--metrics-recording-only',
          '--disable-default-apps',
          '--mute-audio',
          '--no-default-browser-check',
          '--autoplay-policy=user-gesture-required',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
        );

        this.logger.log(`Using Chrome at: ${launchOptions.executablePath}`);
      }

      const browser = await chromium.launch(launchOptions);
      this.logger.log('✅ Playwright browser instance ready');

      return browser;
    } catch (error) {
      this.logger.error('Failed to initialize browser:', error);
      this.logger.error(
        'Make sure Google Chrome is installed on your Windows VPS',
      );
      throw error;
    }
  }

  private async initContext(browser: Browser): Promise<BrowserContext> {
    if (!browser) {
      throw new Error('Browser not initialized');
    }

    // Tạo context với chế độ ẩn danh (incognito)
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: ['geolocation'],
      geolocation: { latitude: 40.7128, longitude: -74.006 },
      colorScheme: 'light',
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
      // Chế độ ẩn danh: không lưu cookies, cache, storage
      storageState: undefined,
      acceptDownloads: false,
      // Xóa hết dữ liệu cũ
      ignoreHTTPSErrors: false,
    });

    // Anti-detection scripts
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });

      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      (window as any).chrome = {
        runtime: {},
      };

      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({
              state: Notification.permission,
            } as PermissionStatus)
          : originalQuery(parameters);
    });

    return context;
  }

  async getCaptcha(isDebug: boolean = false): Promise<string> {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      browser = await this.initBrowser();
      context = await this.initContext(browser);
      const page = await context.newPage();

      try {
        const url = `https://labs.google/fx`;

        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        await page.waitForFunction(
          () => {
            return (
              typeof (window as any).grecaptcha !== 'undefined' &&
              (window as any).grecaptcha.enterprise &&
              typeof (window as any).grecaptcha.enterprise.execute ===
                'function'
            );
          },
          { timeout: 30000 },
        );

        if (isDebug) {
          this.logger.debug(`🔐 Executing reCAPTCHA...`);
        }

        // Execute reCAPTCHA
        const result = await page.evaluate(async () => {
          try {
            const token = await (window as any).grecaptcha.enterprise.execute(
              '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV',
              {
                action: 'FLOW_GENERATION',
              },
            );
            return { success: true, token };
          } catch (error: any) {
            return { success: false, error: error.message };
          }
        });

        if (result.success && result.token) {
          return result.token;
        } else {
          throw new Error(result.error || 'Failed to get captcha token');
        }
      } finally {
        await page.close();
      }
    } catch (error) {
      this.logger.error(`❌ getCaptcha error:`, error);
      throw error;
    } finally {
      if (context) {
        await context.close();
      }
      if (browser) {
        await browser.close();
      }
    }
  }
}
