/// The DCA target asset the user is viewing/choosing. On the local chain there
/// is a single whitelisted target mock, so this is primarily a *display* choice
/// (which market the chart shows, how balances are labelled); the on-chain
/// target address stays the one whitelisted token.
export type Asset = 'BTC' | 'ETH'

export const ASSETS: Record<
	Asset,
	{ symbol: Asset; token: string; binance: string }
> = {
	// `token` is the wrapped-token label shown in KPIs / the swap log.
	BTC: { symbol: 'BTC', token: 'WBTC', binance: 'BTCUSDT' },
	ETH: { symbol: 'ETH', token: 'WETH', binance: 'ETHUSDT' }
}
