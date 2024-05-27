import { Actor, RequestQueue, ProxyConfigurationOptions } from "apify";
import { CheerioCrawler, CheerioCrawlingContext } from "crawlee";

interface Input {
  startUrls: string[];
  maxRequestsPerCrawl: number;
}

interface UserData {
  cityName: string;
  isFinalRequest: boolean;
  offset: number;
  initialRequest: boolean;
  startingUrl: string;
  retryCount: number;
}

await Actor.init();

const {
  startUrls = ["https://www.swiggy.com/city/gurgaon"],
  maxRequestsPerCrawl = 100,
} = (await Actor.getInput<Input>()) ?? ({} as Input);

const requestQueue = await RequestQueue.open();

const maxRetries = 5;

const crawler = new CheerioCrawler({
  maxRequestsPerCrawl,
  requestHandler: async (context: CheerioCrawlingContext) => {
    const { $, request, log, body } = context;
    const {
      cityName,
      isFinalRequest,
      offset,
      initialRequest,
      startingUrl,
      retryCount = 0,
    } = request.userData as UserData;

    const delayTime = 5000;

    try {
      log.info(`Processing request for URL: ${request.url}`);

      if (initialRequest === false) {
        log.info(`Offset: ${offset}`);

        const requestResult = body.toString();
        const result = JSON.parse(requestResult);

        const successData = result.data.success;

        if (
          !successData.cards ||
          !successData.cards[0]?.card?.card?.gridElements?.infoWithStyle
            ?.restaurants
        ) {
          log.error("Unexpected response structure");
          throw new Error("Unexpected response structure");
        }

        const newRestaurants =
          successData.cards[0].card.card.gridElements.infoWithStyle.restaurants;
        const newLinks = newRestaurants.map(
          (restaurant: any) => restaurant.cta.link
        );

        for (const link of newLinks) {
          await requestQueue.addRequest({
            url: link,
            userData: {
              startingUrl,
              initialRequest: false,
              cityName,
              retryCount: 0,
              offset,
              isFinalRequest: false,
            },
          });
        }
      } else {
        log.info(`Processing initial request for page data`);
        const nextDataScript = $("script#__NEXT_DATA__").text();
        if (!nextDataScript) {
          log.error("Could not find __NEXT_DATA__ script tag");
          throw new Error("Could not find __NEXT_DATA__ script tag");
        }

        const nextData = JSON.parse(nextDataScript);

        const getCoordinatesAndRestaurantCount = (nextData: any) => {
          if (
            !nextData ||
            !nextData.props ||
            !nextData.props.pageProps ||
            !nextData.props.pageProps.widgetResponse
          ) {
            log.error("Unexpected structure of __NEXT_DATA__");
            throw new Error("Unexpected structure of __NEXT_DATA__");
          }

          const widgetResponse = nextData.props.pageProps.widgetResponse;
          if (
            !widgetResponse.success ||
            !widgetResponse.success.cards ||
            !Array.isArray(widgetResponse.success.cards)
          ) {
            log.error("Unexpected structure of widgetResponse");
            throw new Error("Unexpected structure of widgetResponse");
          }

          const cards = widgetResponse.success.cards;
          const lastCard = cards[cards.length - 1];
          const fifthCard = cards[4];

          if (!lastCard?.card?.card) {
            log.error("Unexpected structure of the last card");
            throw new Error("Unexpected structure of the last card");
          }

          const lat = lastCard.card.card.lat;
          const lng = lastCard.card.card.lng;

          if (!fifthCard?.card?.card) {
            log.error("Unexpected structure of the fifth card");
            throw new Error("Unexpected structure of the fifth card");
          }

          const restaurantCount = fifthCard.card.card.restaurantCount;

          return { lat, lng, restaurantCount };
        };

        const { lat, lng, restaurantCount } =
          getCoordinatesAndRestaurantCount(nextData);
        log.info(
          `Lat: ${lat}, Lng: ${lng}, Restaurant Count: ${restaurantCount}`
        );

        const urlParts = request.url.split("/");
        const cityNameIndex = urlParts.findIndex((part) => part === "city") + 1;
        const cityName = urlParts[cityNameIndex] || "unknown";
        const apiUrl = `https://www.swiggy.com/api/seo/getListing?lat=${lat}&lng=${lng}`;

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json, text/plain, */*",
          "User-Agent": getRandomUserAgent(),
          Referer: `https://www.swiggy.com/city/${cityName}`,
          Origin: "https://www.swiggy.com",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          Connection: "keep-alive",
          Cookie:
            "__SW=QApf1aeK67heqDf7ITG1k-sZdkHO7QdU; _device_id=de662310-25ac-df81-d28e-e1a9d1b0bc46; userLocation={%22lat%22:%2242.66310%22%2C%22lng%22:%2221.16900%22%2C%22address%22:%22%2C%22area%22:%22%22%2C%22showUserDefaultAddressHint%22:false}; fontsLoaded=1; _gcl_au=1.1.1621102637.1715676401; _ga_YD063E4XCC=GS1.2.1715719033.1.0.1715719033.0.0.0; _ga_76P34S6XQ2=GS1.1.1715719032.1.1.1715719052.0.0.0; _guest_tid=d9fe7b28-b7c7-456b-adf6-91ee394b5199; _gid=GA1.2.1919835917.1715944757; _sid=dvs9db1c-0e00-465a-8a95-60d5906c2401; _gat_0=1; _ga_34JYJ0BCRN=GS1.1.1715944757.10.1.1715946688.0.0.0; _ga=GA1.2.511114625.1715676401",
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
    } catch (error: any) {
      log.error(
        `Error processing request for URL: ${request.url} - ${error.message}`
      );

      if (retryCount < maxRetries) {
        log.info(`Retrying request... Attempt ${retryCount + 1}`);
        await new Promise((resolve) =>
          setTimeout(resolve, retryCount * delayTime)
        );

        await requestQueue.addRequest({
          ...request,
          userData: {
            ...request.userData,
            retryCount: retryCount + 1,
          },
        });
      } else {
        log.error(`Max retries reached for request: ${request.url}`);
      }
    }
  },
});

await crawler.run(startUrls);
await Actor.exit();
function getRandomUserAgent(): string {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.2 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36",
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}
