import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { chromium, Browser, BrowserContext } from 'playwright';
import { Logger } from '@nestjs/common';

declare global {
  interface Window {
    grecaptcha: {
      enterprise: {
        execute: (siteKey: string, options: any) => Promise<string>;
      };
    };
  }
}

interface ProfileQueue {
  context: BrowserContext;
  inUse: boolean;
  lastUsed: number;
  profileId: string;
}

@Injectable()
export class CaptchaService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(CaptchaService.name);
  private browser: Browser | null = null;
  private isInitialized = false;

  // Queue management
  private profiles: Map<string, ProfileQueue> = new Map();
  private readonly MAX_PROFILES = 5; // Số lượng profile tối đa
  private readonly PROFILE_COOLDOWN = 5000; // 5s giữa các lần sử dụng cùng profile
  private requestQueue: Array<{
    resolve: (token: string) => void;
    reject: (error: Error) => void;
    isDebug: boolean;
  }> = [];
  private isProcessingQueue = false;

  async onModuleInit() {
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
        launchOptions.executablePath =
          process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
        launchOptions.args.push(
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--no-first-run',
          '--disable-background-timer-throttling',
        );
      }

      this.logger.log(
        'Launching browser with options: ' + JSON.stringify(launchOptions),
      );

      this.browser = await chromium.launch(launchOptions);
      this.isInitialized = true;
      this.logger.log('✅ Playwright browser instance ready');

      await this.initializeProfiles();
    } catch (error) {
      this.logger.error('Failed to initialize browser:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    // Đóng tất cả profiles
    for (const [id, profile] of this.profiles.entries()) {
      try {
        await profile.context.close();
        this.logger.log(`Closed profile ${id}`);
      } catch (error) {
        this.logger.error(`Error closing profile ${id}:`, error);
      }
    }
    this.profiles.clear();

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
   * Khởi tạo nhiều browser profiles (contexts)
   */
  private async initializeProfiles(): Promise<void> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    this.logger.log(`🔧 Creating ${this.MAX_PROFILES} browser profiles...`);

    for (let i = 0; i < this.MAX_PROFILES; i++) {
      const profileId = `profile_${i}`;

      // Tạo context với các options để bypass detection
      const context = await this.browser.newContext({
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
      });

      // Anti-detection: Override navigator properties
      await context.addInitScript(() => {
        // Remove webdriver property
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });

        // Mock plugins
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });

        // Mock languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });

        // Mock chrome object
        (window as any).chrome = {
          runtime: {},
        };

        // Mock permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters: any) =>
          parameters.name === 'notifications'
            ? Promise.resolve({
                state: Notification.permission,
              } as PermissionStatus)
            : originalQuery(parameters);
      });

      this.profiles.set(profileId, {
        context,
        inUse: false,
        lastUsed: 0,
        profileId,
      });
    }

    this.logger.log(`✅ All ${this.MAX_PROFILES} profiles initialized`);
  }

  /**
   * Lấy profile khả dụng (không đang sử dụng và đã qua cooldown)
   */
  private async getAvailableProfile(): Promise<ProfileQueue | null> {
    const now = Date.now();

    for (const [id, profile] of this.profiles.entries()) {
      if (!profile.inUse && now - profile.lastUsed >= this.PROFILE_COOLDOWN) {
        profile.inUse = true;
        this.logger.debug(`🔓 Profile ${id} acquired`);
        return profile;
      }
    }

    return null;
  }

  /**
   * Giải phóng profile sau khi sử dụng
   */
  private releaseProfile(profile: ProfileQueue): void {
    profile.inUse = false;
    profile.lastUsed = Date.now();
    this.logger.debug(`🔒 Profile ${profile.profileId} released`);
  }

  /**
   * Xử lý hàng đợi request
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const profile = await this.getAvailableProfile();

      if (!profile) {
        // Không có profile khả dụng, chờ 100ms rồi thử lại
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      const request = this.requestQueue.shift();
      if (!request) break;

      // Xử lý request với profile này (không await để xử lý song song)
      this.executeCaptchaWithProfile(profile, request.isDebug)
        .then((token) => request.resolve(token))
        .catch((error) => request.reject(error))
        .finally(() => this.releaseProfile(profile));
    }

    this.isProcessingQueue = false;
  }

  /**
   * API công khai: Thêm request vào hàng đợi
   */
  async getCaptcha(isDebug: boolean = false): Promise<string> {
    if (!this.isInitialized || !this.browser) {
      throw new Error('CaptchaService not initialized');
    }

    return new Promise((resolve, reject) => {
      this.requestQueue.push({ resolve, reject, isDebug });
      this.logger.log(
        `📋 Request queued (queue size: ${this.requestQueue.length})`,
      );
      this.processQueue();
    });
  }

  /**
   * Thực thi captcha với một profile cụ thể
   */
  private async executeCaptchaWithProfile(
    profile: ProfileQueue,
    isDebug: boolean = false,
  ): Promise<string> {
    const page = await profile.context.newPage();

    try {
      const url = `https://labs.google/fx`;
      if (isDebug) {
        this.logger.debug(`🌐 [${profile.profileId}] Loading page: ${url}`);
      }

      // Navigate với timeout
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      if (isDebug) {
        const cookies = await profile.context.cookies();
        this.logger.debug(
          `🍪 [${profile.profileId}] Cookies on page: ${cookies.length}`,
        );

        const sessionToken = cookies.find(
          (c) => c.name === '__Secure-next-auth.session-token',
        );
        this.logger.debug(
          `🔑 [${profile.profileId}] Session token present: ${!!sessionToken}`,
        );
      }

      // Wait for grecaptcha
      if (isDebug) {
        this.logger.debug(
          `⏳ [${profile.profileId}] Waiting for grecaptcha...`,
        );
      }

      await page.waitForFunction(
        () => {
          return (
            typeof (window as any).grecaptcha !== 'undefined' &&
            (window as any).grecaptcha.enterprise &&
            typeof (window as any).grecaptcha.enterprise.execute === 'function'
          );
        },
        { timeout: 30000 },
      );

      if (isDebug) {
        this.logger.debug(`🔐 [${profile.profileId}] Executing reCAPTCHA...`);
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
        if (isDebug) {
          this.logger.debug(`✅ [${profile.profileId}] reCAPTCHA solved`);
        }
        return result.token;
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      this.logger.error(
        `❌ [${profile.profileId}] executeCaptchaWithProfile error:`,
        error,
      );
      throw error;
    } finally {
      try {
        await page.close();
      } catch (error) {
        this.logger.error(
          `⚠️  [${profile.profileId}] Error closing page:`,
          error,
        );
      }
    }
  }
}
