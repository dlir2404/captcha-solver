import { CAPTCHA_VEO3_COOKIES_KEY } from '../../common/const/captcha';
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';
import { type RedisClientType } from 'redis';
import { Logger } from '@nestjs/common';
import { PROJECT_ID_KEY } from 'src/common/const/env.keys';

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
export class CaptchaService implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject('REDIS') private redis: RedisClientType) {}
  private logger = new Logger(CaptchaService.name);

  private projectId = '';
  private browser: Browser | null = null;
  private isInitialized = false;
  private context: any = null;
  private cachedCookies: any = null;

  async onModuleInit() {
    try {
      this.logger.log('🚀 Initializing Puppeteer browser instance...');

      let options: any = {
        headless: false,
      };

      if (process.env.NODE_ENV === 'production') {
        options = {
          headless: false,
          executablePath:
            process.env.PUPPETEER_EXECUTABLE_PATH ||
            '/usr/bin/chromium-browser',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--no-first-run',
            '--disable-background-timer-throttling',
          ],
        };
        // options = {
        //   headless: true, // Hoặc 'new' nếu dùng headless mode mới
        //   executablePath:
        //     process.env.PUPPETEER_EXECUTABLE_PATH ||
        //     '/usr/bin/chromium-browser',
        //   args: [
        //     '--no-sandbox',
        //     '--disable-setuid-sandbox',
        //     '--disable-dev-shm-usage',
        //     '--disable-gpu',
        //     '--disable-software-rasterizer',
        //     '--disable-extensions',
        //     '--no-first-run',
        //     '--no-zygote',
        //     '--single-process', // QUAN TRỌNG: fix namespace error
        //     '--disable-background-timer-throttling',
        //     '--disable-backgrounding-occluded-windows',
        //     '--disable-renderer-backgrounding',
        //     '--disable-features=IsolateOrigins,site-per-process',
        //     '--disable-blink-features=AutomationControlled',
        //     '--window-size=1920,1080',
        //   ],
        // };
      }

      this.logger.log(
        'Launching browser with options:' + JSON.stringify(options),
      );

      this.browser = await puppeteer.launch(options);
      this.isInitialized = true;
      this.logger.log('Puppeteer browser instance ready');
      // Load cookies on startup
      await this.reloadCookies();
    } catch (error) {
      this.logger.error('Failed to initialize browser:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.browser) {
      try {
        await this.browser.close();
        this.logger.log('Browser instance closed');
      } catch (error) {
        this.logger.error('Error closing browser:', error);
      }
    }
  }

  /**
   * Reload cookies from storage - call this when cookies change (e.g., daily)
   * Can be triggered manually or scheduled with cron
   */
  async reloadCookies(): Promise<void> {
    const projectId = (await this.redis.get(PROJECT_ID_KEY)) || '';
    this.projectId = projectId;

    const rawCookies = await this.redis.get(CAPTCHA_VEO3_COOKIES_KEY);
    const cookieData = rawCookies ? JSON.parse(atob(rawCookies)) : null;

    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    try {
      this.logger.log('🔄 Reloading cookies...');

      if (this.context) {
        await this.context.close();
      }

      this.context = await this.browser.createBrowserContext();

      if (cookieData) {
        this.logger.log(
          '🍪 Original cookie count:' + cookieData.cookies.length,
        );

        const puppeteerCookies = this.convertCookies(cookieData);

        this.logger.log('🍪 Converted cookie count:' + puppeteerCookies.length);
        this.logger.log(
          '🍪 Cookie names:' + puppeteerCookies.map((c) => c.name).join(', '),
        );

        // Check session token in converted list
        const sessionToken = puppeteerCookies.find(
          (c) => c.name === '__Secure-next-auth.session-token',
        );
        this.logger.log('🔑 Session token in converted?' + !!sessionToken);
        if (sessionToken) {
          this.logger.log(
            '🔑 Session token details:' +
              JSON.stringify({
                name: sessionToken.name,
                domain: sessionToken.domain,
                secure: sessionToken.secure,
                httpOnly: sessionToken.httpOnly,
                sameSite: sessionToken.sameSite,
                expires: sessionToken.expires,
              }),
          );
        }

        // TRY SETTING COOKIES ONE BY ONE
        let successCount = 0;
        const failedCookies: any[] = [];

        for (const cookie of puppeteerCookies) {
          try {
            await this.context.setCookie(cookie);
            successCount++;

            if (cookie.name.includes('session-token')) {
              this.logger.log('✅ Session token setCookie() succeeded');
            }
          } catch (error) {
            failedCookies.push({ name: cookie.name, error: error.message });
            this.logger.error(
              `Failed to set cookie ${cookie.name}:`,
              error.message,
            );
          }
        }

        this.logger.log(
          `🍪 Set results: ${successCount} success, ${failedCookies.length} failed`,
        );
        if (failedCookies.length > 0) {
          this.logger.error('Failed cookies:', failedCookies);
        }

        // VERIFY what's actually in context
        const setCookies = await this.context.cookies();
        this.logger.log(`🍪 Cookies actually in context: ${setCookies.length}`);
        this.logger.log(
          `🍪 Names in context:` + setCookies.map((c) => c.name).join(','),
        );

        const contextSessionToken = setCookies.find(
          (c) => c.name === '__Secure-next-auth.session-token',
        );
        this.logger.log(
          '🔑 Session token in context after set?' + !!contextSessionToken,
        );

        this.cachedCookies = puppeteerCookies;
        this.logger.log('✅ Cookies reloaded and cached in browser context');
      } else {
        this.logger.warn(
          '⚠️  No cookie data provided, context ready without cookies',
        );
      }
    } catch (error) {
      this.logger.error('❌ Error reloading cookies:', error);
      throw error;
    }
  }

  async getCaptcha(isDebug: boolean = false): Promise<string> {
    if (!this.isInitialized || !this.browser || !this.context) {
      throw new Error(
        'CaptchaService not initialized. Browser or context unavailable.',
      );
    }

    if (!this.projectId) {
      throw new Error('Project ID not set. Please configure environment.');
    }

    if (!this.browser.isConnected()) {
      throw new Error('Browser connection lost. Please try again.');
    }

    let page;
    try {
      page = await this.context.newPage();
    } catch (error) {
      this.logger.error('❌ Failed to create page:', error);
      throw new Error('Failed to create browser page');
    }

    try {
      const url = `https://labs.google/fx/tools/flow/project/${this.projectId}/`;
      if (isDebug) {
        this.logger.debug('🌐 Loading page:' + url);
      }

      // Navigate to the final URL first (without cookies, will show login page)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      if (isDebug) {
        this.logger.debug('✅ Initial page load (not logged in yet)');
      }

      // NOW set cookies on the already-loaded page
      if (this.cachedCookies && this.cachedCookies.length > 0) {
        if (isDebug) {
          this.logger.debug('🍪 Setting cookies on page...');
        }

        try {
          await page.setCookie(...this.cachedCookies);
          if (isDebug) {
            this.logger.debug('✅ Cookies set on page');
          }
        } catch (error) {
          this.logger.error('❌ Error setting cookies:', error);
          // Try one by one
          let successCount = 0;
          for (const cookie of this.cachedCookies) {
            try {
              await page.setCookie(cookie);
              successCount++;
              if (
                cookie.name === '__Secure-next-auth.session-token' &&
                isDebug
              ) {
                this.logger.debug('✅ Session token set successfully');
              }
            } catch (err) {
              this.logger.error(
                `❌ Failed to set ${cookie.name}:`,
                err.message,
              );
            }
          }
          if (isDebug) {
            this.logger.debug(
              `🍪 Set ${successCount}/${this.cachedCookies.length} cookies`,
            );
          }
        }
      }

      if (isDebug) {
        const currentCookies = await page.cookies();
        this.logger.debug('🍪 Cookies on page:' + currentCookies.length);
        this.logger.debug(
          '🍪 Debug - All cookies:',
          currentCookies.map((c) => c.name).join(', '),
        );

        const sessionToken = currentCookies.find(
          (c) => c.name === '__Secure-next-auth.session-token',
        );
        this.logger.debug('🔑 Session token on page?' + !!sessionToken);
        if (!sessionToken) {
          this.logger.error('❌ WARNING: Session token missing on page!');
        }

        const screenshotBuffer = await page.screenshot({ fullPage: true });
      }

      if (isDebug) {
        // Wait for grecaptcha
        this.logger.debug('⏳ Waiting for grecaptcha...');
      }
      await page.waitForFunction(
        () => {
          return (
            typeof window.grecaptcha !== 'undefined' &&
            window.grecaptcha.enterprise &&
            typeof window.grecaptcha.enterprise.execute === 'function'
          );
        },
        { timeout: 30000 },
      );

      if (isDebug) {
        this.logger.debug('🔐 Executing reCAPTCHA...');
      }

      // Execute reCAPTCHA
      const result = await page.evaluate(async () => {
        try {
          const token = await window.grecaptcha.enterprise.execute(
            '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV',
            {
              action: 'FLOW_GENERATION',
            },
          );
          return { success: true, token };
        } catch (error) {
          return { success: false, error: error.message };
        }
      });

      if (result.success && result.token) {
        if (isDebug) {
          this.logger.debug('✅ reCAPTCHA solved, token obtained');
        }
        return result.token;
      } else {
        this.logger.error('❌ Error:', result.error);
        throw new Error(result.error);
      }
    } catch (error) {
      this.logger.error('❌ getCaptcha error:', error);
      throw error;
    } finally {
      try {
        await page.close();
      } catch (error) {
        this.logger.error('⚠️  Error closing page:', error);
      }
    }
  }

  convertCookies(cookieData: any) {
    // Parse nếu là string
    const data =
      typeof cookieData === 'string' ? JSON.parse(cookieData) : cookieData;

    return data.cookies.map((cookie: any) => {
      const converted: any = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
      };

      if (cookie.expirationDate && !cookie.session) {
        converted.expires = cookie.expirationDate;
      }

      if (cookie.sameSite && cookie.sameSite !== 'unspecified') {
        converted.sameSite =
          cookie.sameSite.charAt(0).toUpperCase() + cookie.sameSite.slice(1);
      }

      return converted;
    });
  }
}
