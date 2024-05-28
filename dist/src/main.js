import { Actor, RequestQueue } from "apify";
import { CheerioCrawler } from "crawlee";
import { getRandomUserAgent } from "../helpers/getRandomUserAgent.js";
import { getCoordinatesAndRestaurantCount } from "../helpers/getCoordinatesAndRestaurantCount.js";
import { cookies } from "../consts/requestCookies.js";
await Actor.init();
const { startUrls = ["https://www.swiggy.com/city/gurgaon"], maxRequestsPerCrawl = 100, } = (await Actor.getInput()) ?? {};
const requestQueue = await RequestQueue.open();
const maxRetries = 5;
const crawler = new CheerioCrawler({
    maxRequestsPerCrawl,
    requestHandler: async (context) => {
        const { $, request, log, body } = context;
        const { cityName, isFinalRequest, offset, initialRequest, startingUrl, retryCount = 0, } = request.userData;
        const delayTime = 5000;
        try {
            console.log(request, "request");
            console.log("ahhahahahaahsbgo;dsogbsad b", context);
            log.info(`Processing request for URL: ${request.url}`);
            console.log(initialRequest, "initialrequest");
            if (initialRequest === false) {
                log.info(`Offset: ${offset}`);
                const requestResult = body.toString();
                const result = JSON.parse(requestResult);
                const successData = result.data.success;
                if (!successData.cards ||
                    !successData.cards[0]?.card?.card?.gridElements?.infoWithStyle
                        ?.restaurants) {
                    log.error("Unexpected response structure");
                    throw new Error("Unexpected response structure");
                }
                const newRestaurants = successData.cards[0].card.card.gridElements.infoWithStyle.restaurants;
                const newLinks = newRestaurants.map((restaurant) => restaurant.cta.link);
            }
            else {
                log.info(`Processing initial request for page data`);
                const nextDataScript = $("script#__NEXT_DATA__").text();
                if (!nextDataScript) {
                    log.error("Could not find __NEXT_DATA__ script tag");
                    throw new Error("Could not find __NEXT_DATA__ script tag");
                }
                const nextData = JSON.parse(nextDataScript);
                const { lat, lng, restaurantCount } = getCoordinatesAndRestaurantCount(nextData, log);
                log.info(`Lat: ${lat}, Lng: ${lng}, Restaurant Count: ${restaurantCount}`);
                const urlParts = request.url.split("/");
                const cityNameIndex = urlParts.findIndex((part) => part === "city") + 1;
                const cityName = urlParts[cityNameIndex] || "unknown";
                const apiUrl = `https://www.swiggy.com/api/seo/getListing?lat=${lat}&lng=${lng}`;
                const headers = {
                    "Content-Type": "application/json",
                    Accept: "application/json, text/plain, */*",
                    "User-Agent": getRandomUserAgent(),
                    Referer: `https://www.swiggy.com/city/${cityName}`,
                    Origin: "https://www.swiggy.com",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate, br",
                    Connection: "keep-alive",
                    Cookie: cookies,
                };
                const limit = 15;
                const requestIterations = Math.ceil(restaurantCount / limit);
                for (let i = 0; i < requestIterations; i++) {
                    const offset = i === 0 ? 1 : i * limit;
                    const payload = {
                        isFiltered: false,
                        facets: {},
                        seoParams: {},
                        widgetOffset: {
                            NewListingView_category_bar_chicletranking_TwoRows: "",
                            NewListingView_category_bar_chicletranking_TwoRows_Rendition: "",
                            Restaurant_Group_WebView_PB_Theme: "",
                            Restaurant_Group_WebView_SEO_PB_Theme: "",
                            collectionV5RestaurantListWidget_SimRestoRelevance_food_seo: `${offset}`,
                            inlineFacetFilter: "",
                            restaurantCountWidget: "",
                        },
                        nextOffset: `${offset}`,
                    };
                    await requestQueue.addRequest({
                        url: apiUrl,
                        method: "POST",
                        headers,
                        payload: JSON.stringify(payload),
                        userData: {
                            startingUrl: request.url,
                            initialRequest: false,
                            cityName,
                            retryCount: 0,
                            offset,
                            isFinalRequest: false,
                        },
                        useExtendedUniqueKey: true,
                    });
                }
            }
        }
        catch (error) {
            log.error(`Error processing request for URL: ${request.url} - ${error.message}`);
            if (retryCount < maxRetries) {
                log.info(`Retrying request... Attempt ${retryCount + 1}`);
                await new Promise((resolve) => setTimeout(resolve, retryCount * delayTime));
                await requestQueue.addRequest({
                    ...request,
                    userData: {
                        ...request.userData,
                        retryCount: retryCount + 1,
                    },
                });
            }
            else {
                log.error(`Max retries reached for request: ${request.url}`);
            }
        }
    },
});
await crawler.run(startUrls);
await Actor.exit();
//# sourceMappingURL=main.js.map