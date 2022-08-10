const cliSpinners = require('cli-spinners');
const logUpdate = require('log-update');
const Crawler = require('crawler');
const {chromium, firefox, webkit} = require('playwright');
const fs = require('fs');
const args = process.argv.slice(2);
const timestamp = +new Date();
let interval;
let cookies = null;

if (!args.length) {
    throw new Error('URL missing');
}

const url = new URL(args[0]);
const cookieJar = args[1];

if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Not a valid URL');
}

if (typeof cookieJar !== 'undefined') {
    cookies = JSON.parse(fs.readFileSync(cookieJar));
}

const URLToCrawl = removeTrailingSlash(args[0]);
const logger = new console.Console(fs.createWriteStream('./log.txt'));

// already crawled url collection...
let obsolete = [];
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
    const extension = getExtension(url);

    // if is obsolete...
    if (obsolete.includes(url)) {
        return true;
    }

    // if is mail...
    // if is phone...
    // if is page anchor...
    if (emailRegex.test(url) ||
        url.includes('mailto:') ||
        url.includes('tel:') ||
        url.includes('#') || url.includes('/#' ||
        url.includes(':javascript') || url.includes('javascript:') || url.includes('javascript'))) {
        obsolete.push(url);
        return true;
    }

    // if is a file...
    if (extension !== 'html' && extension !== 'php' && extension) {
        obsolete.push(url);
        return true;
    }

    // if is relative...
    if (!absoluteRegex.test(url)) {
        return false;
    }

    // if is external...
    if (!url.includes(URLToCrawl)) {
        return true;
    }

    obsolete.push(url);
    return false;
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

    const browserOptions = {
        headless: true
    };

    // launch different browser types
    const browsers = {
        'chromium': await chromium.launch(browserOptions),
        'firefox': await firefox.launch(browserOptions),
        'webkit': await webkit.launch(browserOptions)
    }

    /**
     * crawl the given url...
     * credits @Evyatar Meged - https://stackoverflow.com/a/50164565
     *
     * @param urlToCrawl
     * @returns {Promise<void>}
     */
    async function crawlUrl(urlToCrawl) {
        crawl.queue({
            uri: urlToCrawl,
            callback: async function (error, result, done) {
            if (error) {
                    console.log(error);
                }
                else {
                    if (parseInt(result.statusCode) > 399) {
                        console.error(result.statusCode + ' - ' + url);
                        logger.log(result.statusCode + ' : ' + url);
                    }
                    else {
                        let $ = result.$;
                        let urls = $('a');
                        let items = Object.keys(urls);

                        for (let i = 0; i < items.length; i++) {
                            const item = items[i];

                            if (urls[item].type === 'tag') {
                                let href = urls[item].attribs.href;
                                if (href !== '' && !shouldSkip(href)) {
                                    href = href.trim();
                                    obsolete.push(href);

                                    const url = new URL(href, urlToCrawl).href;

                                    /**
                                     * create browser contexts
                                     */
                                    try {
                                        await takeScreenshots(url);
                                    }
                                    catch (error) {
                                        console.error('script.js:146', error);
                                    }

                                    setTimeout(async () => {
                                        await crawlUrl(url);
                                    }, 100)
                                }
                            }
                        }
                    }

                    done();
                }
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
        const contexts = {
            'chromium': await browsers['chromium'].newContext(),
            'firefox': await browsers['firefox'].newContext(),
            'webkit': await browsers['webkit'].newContext()
        }

        const pages = {
            'chromium': await contexts['chromium'].newPage(),
            'firefox': await contexts['firefox'].newPage(),
            'webkit': await contexts['webkit'].newPage()
        }

        if (cookies) {
            await Promise.all(Object.keys(contexts).map(browserName =>
                contexts[browserName].addCookies(cookies)
            ));
        }
        
        await Promise.all(Object.keys(pages).map(browserName =>
            pages[browserName].goto(url, {timeout: 60000})
        ));

        await Promise.all(Object.keys(pages).map(browserName => {
            pages[browserName].evaluate(() => {
                if (typeof lazy !== "undefined") lazy.loadAll()
            });
        }))

        await Promise.all(Object.keys(pages).map(browserName =>
            pages[browserName].waitForTimeout(500)
        ))

        let title = slugify(url.replace(URLToCrawl, ''));

        if (title === '') {
            title = await pages['chromium'].title();
            title = slugify(title);
        }

        await Promise.all(Object.keys(pages).map(browserName =>
            pages[browserName].screenshot({path: timestamp + '/' + title + '-' + browserName + '.png', fullPage: true})
        ))

        await Promise.all(Object.keys(contexts).map(browserName =>
            contexts[browserName].close()
        ))
    }

    // get the front page...
    await takeScreenshots(URLToCrawl);
    // start with the given url...
    await crawlUrl(URLToCrawl);

    /**
     * close browser...
     *
     * @returns {Promise<void>}
     */
    async function closeBrowser() {
        if (shouldClose) {
            await Promise.all(Object.keys(browsers).map(browserName =>
                browsers[browserName].close()
            ))

            clearInterval(interval);
            shouldClose = false;
        }
    }
})()

function removeTrailingSlash(str) {
    return str.replace(/\/+$/, '');
}

function getExtension(url) {
    const extStart = url.indexOf('.', url.lastIndexOf('/') + 1);

    if (extStart == -1) {
        return false;
    }

    const ext = url.substr(extStart + 1), extEnd = ext.search(/$|[?#]/);
    return ext.substring(0, extEnd);
}
