export const getCoordinatesAndRestaurantCount = (nextData, log) => {
    if (!nextData ||
        !nextData.props ||
        !nextData.props.pageProps ||
        !nextData.props.pageProps.widgetResponse) {
        log.error("Unexpected structure of __NEXT_DATA__");
        throw new Error("Unexpected structure of __NEXT_DATA__");
    }
    const widgetResponse = nextData.props.pageProps.widgetResponse;
    if (!widgetResponse.success ||
        !widgetResponse.success.cards ||
        !Array.isArray(widgetResponse.success.cards)) {
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
//# sourceMappingURL=getCoordinatesAndRestaurantCount.js.map