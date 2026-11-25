import fs from "fs";
import { chromium, type BrowserContext } from "playwright";
import { BROWSER_PROFILE_DIR, PORTAL_BOOKING_URL } from "../config";

const LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-blink-features=AutomationControlled",
];

export function isAuthenticatedPortalUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (!lower.includes("learner.saveetha.in/academicevents/event-booking")) {
    return false;
  }
  if (lower.includes("/login") || lower.includes("/sso") || lower.includes("/authorize")) {
    return false;
  }
  return true;
}

export class PortalBrowserManager {
  private readonly profileDir: string;
  private context: BrowserContext | null = null;
  private lockPromise: Promise<void> = Promise.resolve();

  constructor(profileDir: string = BROWSER_PROFILE_DIR) {
    this.profileDir = profileDir;
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.lockPromise;
    let release!: () => void;
    this.lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async ensureHeadlessContext(): Promise<BrowserContext> {
    return this.withLock(async () => {
      if (this.context) {
        return this.context;
      }
      fs.mkdirSync(this.profileDir, { recursive: true });
      this.context = await chromium.launchPersistentContext(this.profileDir, {
        headless: true,
        args: LAUNCH_ARGS,
      });
      return this.context;
    });
  }

  async close(): Promise<void> {
    return this.withLock(async () => {
      if (this.context) {
        try {
          await this.context.close();
        } catch {
          // ignore close errors
        }
        this.context = null;
      }
    });
  }

  /**
   * Launch a visible Chromium window using the persistent profile so the user
   * can complete college SSO login manually. Closes the interactive window
   * once authenticated and preserves cookies/session in `profileDir`.
   */
  async connectInteractive(timeoutMs = 180_000): Promise<{
    success: boolean;
    message: string;
  }> {
    return this.withLock(async () => {
      if (this.context) {
        try {
          await this.context.close();
        } catch {
          // ignore
        }
        this.context = null;
      }

      fs.mkdirSync(this.profileDir, { recursive: true });
      let interactiveContext: BrowserContext | null = null;

      try {
        interactiveContext = await chromium.launchPersistentContext(this.profileDir, {
          headless: false,
          args: LAUNCH_ARGS,
        });

        const page =
          interactiveContext.pages()[0] || (await interactiveContext.newPage());
        await page.goto(PORTAL_BOOKING_URL, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (page.isClosed()) {
            return {
              success: false,
              message: "Login window was closed before authentication completed.",
            };
          }

          const currentUrl = page.url();
          if (isAuthenticatedPortalUrl(currentUrl)) {
            const html = await page.content().catch(() => "");
            if (
              html.includes("booking-term") ||
              html.includes("academicevents") ||
              html.includes("Event Booking")
            ) {
              return {
                success: true,
                message: "Portal authenticated and session saved locally.",
              };
            }
          }

          await new Promise((r) => setTimeout(r, 1500));
        }

        return {
          success: false,
          message: "Timed out waiting for manual portal login.",
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          message: `Failed to launch interactive browser: ${msg}`,
        };
      } finally {
        if (interactiveContext) {
          try {
            await interactiveContext.close();
          } catch {
            // ignore
          }
        }
      }
    });
  }
}
