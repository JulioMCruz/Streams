/* eslint-disable @next/next/no-img-element */
/**
 * Brand/token marks used across the UI so users recognise the pieces at a
 * glance. These are the real SVGs in `public/img/`; we render them with a
 * plain <img> (sized via `className`) — no next/image config needed for these
 * static local assets.
 */

type IconProps = { className?: string }

const Mark = ({
	src,
	alt,
	className
}: {
	src: string
	alt: string
	className?: string
}) => (
	<img
		src={src}
		alt={alt}
		draggable={false}
		className={className ?? 'h-4 w-4'}
	/>
)

/** USDC — the streamed stablecoin. */
export function UsdcLogo({ className }: IconProps) {
	return (
		<Mark src="/img/usd-coin-usdc-logo.svg" alt="USDC" className={className} />
	)
}

/** Bitcoin / WBTC — the DCA target. */
export function BtcLogo({ className }: IconProps) {
	return (
		<Mark src="/img/bitcoin-btc-logo.svg" alt="Bitcoin" className={className} />
	)
}

/** Uniswap — where the bot routes its swaps. */
export function UniswapLogo({ className }: IconProps) {
	return (
		<Mark src="/img/uniswap-uni-logo.svg" alt="Uniswap" className={className} />
	)
}

/** ENS — the bot's on-chain name. */
export function EnsLogo({ className }: IconProps) {
	return (
		<Mark
			src="/img/ethereum-name-service-ens-logo.svg"
			alt="ENS"
			className={className}
		/>
	)
}

/** Ethereum / WETH — the alternate DCA target. */
export function EthLogo({ className }: IconProps) {
	return (
		<Mark src="/img/ethereum-eth-logo.svg" alt="Ethereum" className={className} />
	)
}

/** Chainlink — the decentralized execution layer (CRE workflow). */
export function ChainlinkLogo({ className }: IconProps) {
	return (
		<Mark
			src="/img/chainlink-link-logo.svg"
			alt="Chainlink"
			className={className}
		/>
	)
}
