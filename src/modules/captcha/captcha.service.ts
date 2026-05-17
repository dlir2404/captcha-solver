import { Injectable, Logger } from '@nestjs/common';
import { chromium, Browser, BrowserContext, LaunchOptions } from 'playwright';
import { CaptchaAction } from 'src/constant';

declare global {
  interface Window {
    grecaptcha: {
      enterprise: {
        execute: (siteKey: string, options: any) => Promise<string>;
      };
    };
  }
}

// Constants
const RECAPTCHA_CONFIG = {
  siteKey: '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV',
  targetUrl: 'https://labs.google/fx',
} as const;

const TIMEOUTS = {
  PAGE_LOAD: 30000,
  RECAPTCHA_READY: 30000,
} as const;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Browser arguments optimized for Docker + Playwright
const BROWSER_ARGS = [
  // Required for Docker/containerized environments
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  // Anti-detection
  '--disable-blink-features=AutomationControlled',
  // Performance and cleanup
  '--disable-gpu',
  '--disable-extensions',
  '--no-first-run',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-default-apps',
  '--mute-audio',
  '--no-default-browser-check',
];

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  private getAntiDetectionScript(): string {
    return `
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });

      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      window.chrome = {
        runtime: {},
      };

      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({
              state: Notification.permission,
            })
          : originalQuery(parameters);
    `;
  }

  async initBrowser(): Promise<Browser> {
    try {
      this.logger.log('Initializing Playwright browser instance...');

      const launchOptions: LaunchOptions = {
        headless: true,
        args: BROWSER_ARGS,
      };

      const browser = await chromium.launch(launchOptions);
      this.logger.log('Playwright browser instance ready');

      return browser;
    } catch (error) {
      this.logger.error('Failed to initialize browser:', error);
      throw error;
    }
  }

  private async initContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: USER_AGENT,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: ['geolocation'],
      geolocation: { latitude: 40.7128, longitude: -74.006 },
      colorScheme: 'light',
    });

    await context.addInitScript(this.getAntiDetectionScript());

    return context;
  }

  async getCaptcha(
    action: CaptchaAction = CaptchaAction.IMAGE_GENERATION,
    isDebug: boolean = false,
  ): Promise<string> {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      browser = await this.initBrowser();
      context = await this.initContext(browser);
      const page = await context.newPage();

      try {
        await page.goto(RECAPTCHA_CONFIG.targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: TIMEOUTS.PAGE_LOAD,
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
          { timeout: TIMEOUTS.RECAPTCHA_READY },
        );

        if (isDebug) {
          this.logger.debug('Executing reCAPTCHA...');
        }

        const result = await page.evaluate(
          async ({ siteKey, action }) => {
            try {
              const token = await (window as any).grecaptcha.enterprise.execute(
                siteKey,
                { action },
              );
              return { success: true, token };
            } catch (error: any) {
              return { success: false, error: error.message };
            }
          },
          {
            siteKey: RECAPTCHA_CONFIG.siteKey,
            action,
          },
        );

        if (result.success && result.token) {
          return result.token;
        }

        throw new Error(result.error || 'Failed to get captcha token');
      } finally {
        await page.close();
      }
    } catch (error) {
      this.logger.error('getCaptcha error:', error);
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
