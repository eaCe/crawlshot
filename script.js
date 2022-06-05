const cliSpinners = require('cli-spinners');
const logUpdate = require('log-update');
const Crawler = require('crawler');
const {chromium, firefox, webkit} = require('playwright');
const args = process.argv.slice(2);
const timestamp = +new Date();
let interval;

if (!args.length) {
    throw new Error('URL missing');
}

const url = new URL(args[0]);
if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Not a valid URL');
}

const URLToCrawl = args[0];

// already crawled url collection...
let obselete = [];
let shouldClose = true;

/**
 * skip url if certain conditions match
 *
 * @param url
 * @returns {boolean}
 */
const shouldSkip = (url) => {
    const absoluteRegex = new RegExp('^(?:[a-z]+:)?//', 'i');
    const emailRegex = new RegExp('^\\S+@\\S+$', 'i');

    // if is obsolete...
    if(obselete.includes(url)) {
        return true;
    }

    // if is mail...
    // if is page anchor...
    if (emailRegex.test(url) || url.includes('mailto:') ||
        url.includes('#') || url.includes('/#' ||
        url.includes(':javascript') || url.includes('javascript:') || url.includes('javascript'))
    ) {
        obselete.push(url);
        return true;
    }

    // if is relative...
    if (!absoluteRegex.test(url)) {
        return false;
    }

    obselete.push(url);
    return true;
};

(async () => {
    // initialize crawler
    const crawl = new Crawler();

    console.log('Crawling pages, this could take several minutes or hours');

    // ¯\_(ツ)_/¯
    let i = 0;
    interval = setInterval(() => {
        const frames = cliSpinners.pong.frames;
        logUpdate(frames[i = ++i % frames.length]);
    }, cliSpinners.pong.interval);

    // launch different browser types
    const c = await chromium.launch();
    const f = await firefox.launch();
    const w = await webkit.launch();

    /**
     * crawl the given url...
     * credits @Evyatar Meged - https://stackoverflow.com/a/50164565
     *
     * @param url
     * @returns {Promise<void>}
     */
    async function crawlUrl(url) {
        crawl.queue({
            uri: url,
            callback: async function (err, res, done) {
                if (err) throw err;
                let $ = res.$;
                try {
                    let urls = $('a');
                    let items = Object.keys(urls);

                    for (let i = 0; i < items.length; i++) {
                        const item = items[i];

                        if (urls[item].type === 'tag') {
                            let href = urls[item].attribs.href;

                            if (href && !shouldSkip(href)) {
                                href = href.trim();
                                obselete.push(href);
                                url = href.startsWith(URLToCrawl) ? href : `${URLToCrawl}${href}`;

                                /**
                                 * create browser contexts
                                 */
                                await takeScreenshots(url);

                                setTimeout(async () => {
                                    await crawlUrl(url);
                                }, 100)
                            }
                        }
                    }
                } catch (e) {
                    console.error(`Encountered an error crawling ${url}. Aborting crawl.`);
                    done();
                }

                done();
            }
        });
    }

    // close browser if queue is empty
    crawl.on('drain', () => {
        closeBrowser();
    });

    const slugify = (title) => title.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');

    /**
     * take screenshots from given url
     *
     * @param url
     * @returns {Promise<void>}
     */
    async function takeScreenshots(url) {
        const cctxt = await c.newContext()
        const fctxt = await f.newContext()
        const wctxt = await w.newContext()

        const cpage = await cctxt.newPage();
        const fpage = await fctxt.newPage();
        const wpage = await wctxt.newPage();

        await cpage.goto(url);
        await fpage.goto(url);
        await wpage.goto(url);

        const title = slugify(url.replace(URLToCrawl, ''));

        await cpage.screenshot({path: timestamp + '/' + title + '-chrome.png', fullPage: true});
        await fpage.screenshot({path: timestamp + '/' + title + '-ff.png', fullPage: true});
        await wpage.screenshot({path: timestamp + '/' + title + '-webkit.png', fullPage: true});

        await cctxt.close();
        await fctxt.close();
        await wctxt.close();
    }

    // start with the given url...
    await crawlUrl(URLToCrawl);

    /**
     * close browser...
     *
     * @returns {Promise<void>}
     */
    async function closeBrowser() {
        if (shouldClose) {
            await c.close();
            await f.close();
            await w.close();
            clearInterval(interval);
            shouldClose = false;
        }
    }
})()
