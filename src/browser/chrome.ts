import { chromium, ChromiumBrowser } from "playwright-chromium";
import { log } from "utils";

type RenderResult = {
  error: string | undefined;
  result: any;
};

let globalBrowser: Promise<ChromiumBrowser>;

export const getGlobalBrowser = () => {
  if (globalBrowser) {
    return globalBrowser;
  }
  return (globalBrowser = new Promise(async (resolve) => {
    const browser = await chromium
      .launch({
        headless: true,
        ...(process.env.CHROME_BIN
          ? { executablePath: process.env.CHROME_BIN }
          : {}),
      })
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
    await browser.newPage(); // Open a first tab which should always be blank.

    log(`Global browser is ready.`);
    resolve(browser);
  }));
};

export const closeBrowser = async () => {
  if (globalBrowser && (await globalBrowser).isConnected()) {
    await (await globalBrowser).close();
    log(`Global browser is closed.`);
  }
};

export const openUrl = async ({
  url,
  js = "",
  timeout = 25000,
  waitAfterResourcesLoad = 1000,
  takePdfSnapshot = false,
}: {
  url: string;
  js?: string;
  timeout?: number;
  waitAfterResourcesLoad?: number;
  takePdfSnapshot?: boolean;
}) => {
  const browser = await getGlobalBrowser();
  const page = await browser.newPage();
  let closingThePage = false;
  let lastRequestTimeout: number;
  let renderResolveFunction: (value: RenderResult) => void;
  let pdfBuffer: Buffer = Buffer.from([]);
  let pageHtmlBeforeClosing = "";
  const renderPromise = new Promise<RenderResult>((resolve) => {
    renderResolveFunction = resolve;
  });
  const closePage = async (error?: Error | undefined, result?: any) => {
    // Must be safe to call multiple times.
    if (closingThePage) {
      return;
    }
    closingThePage = true;

    log(`Closing ${url} with result=${result}, error=${error}`);

    clearTimeout(pageTimeout);
    clearTimeout(lastRequestTimeout);

    if (takePdfSnapshot) {
      pdfBuffer = await page.pdf({ format: "A4" });
    }

    if (!page.isClosed()) {
      log(
        `Page hasn't been closed yet, getting HTML from it and closing it...`
      );
      pageHtmlBeforeClosing = await page.innerHTML("html");
      await page.close();
    }

    const responseError = error
      ? (error.stack || error.message || error + "").replace(
          // Cleanup error stack from fuss
          /\n\s+at UtilityScript\.[\w\W]*/,
          ""
        )
      : undefined;
    const responseResult = typeof result === "undefined" ? null : result;

    if (!responseError && !responseResult) {
      log(
        `No result neither error on page close of ${url}. Page HTML before closing is:\n\n${pageHtmlBeforeClosing}`
      );
    }

    renderResolveFunction({
      error: responseError,
      result: responseResult,
    });
  };
  const pageTimeout = setTimeout(closePage, timeout);

  let requestsMade = 0;
  let requestsFinished = 0;

  const onRequestEnd = () => {
    if (++requestsFinished === requestsMade) {
      lastRequestTimeout = setTimeout(closePage, waitAfterResourcesLoad);
    }
  };

  page.on("request", () => {
    clearTimeout(lastRequestTimeout);
    ++requestsMade;
  });
  page.on("requestfailed", onRequestEnd);
  page.on("requestfinished", onRequestEnd);

  log(`Opening page ${url}...`);
  await page.goto(url, {
    waitUntil: "domcontentloaded",
  });

  if (js) {
    log(`Evaluating given JavaScript on the page ${url}...`);
    page
      .evaluate(async (js) => {
        // Warning: even though this code seems to be native to the current context (typescript),
        // IT IS INDEED TAKEN AS-IS AND IS EXECUTED IN THE BROWSER. ANY TYPE DECLARATIONS OR
        // TYPESCRIPT TRANSPILER ARTIFACTS WILL FAIL THIS CODE IN THE BROWSER.
        const AsyncFunction = Object.getPrototypeOf(
          async function () {}
        ).constructor;
        const f = new AsyncFunction("webrender", js);
        try {
          return await f();
        } catch (e) {
          throw e;
        }
      }, js)
      .then((r) => closePage(undefined, r))
      .catch((e) => {
        // page.evaluate will throw an error if the page was closed, but evaluation was not complete.
        if (!closingThePage) {
          log(`[i] ${url}: JavaScript evaluation errored: ${e}`);
          closePage(e);
        } else {
          log(
            `[i] ${url}: JavaScript evaluation was not complete before the page was closed.`
          );
        }
      });
  }

  const result = await renderPromise;

  return {
    url: await page.url(),
    ...result,
    ...(pdfBuffer.length ? { pdfSnapshot: pdfBuffer.toString("base64") } : {}),
  };
};
