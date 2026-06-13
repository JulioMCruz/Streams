import { task, types } from 'hardhat/config'

const ERC20_ABI = [
	'function balanceOf(address) view returns (uint256)',
	'function decimals() view returns (uint8)',
	'function symbol() view returns (string)'
]

task(
	'smart-account:inspect',
	'Reads owner, operator, rules, target tokens, and balances of provided tokens for a smart account.'
)
	.addParam('sa', 'SmartAccountDCA address', undefined, types.string)
	.addOptionalParam(
		'tokens',
		'Comma-separated token addresses to print balances for',
		'',
		types.string
	)
	.setAction(async (args, hre) => {
		const { ethers } = hre

		const sa = await ethers.getContractAt('SmartAccountDCA', args.sa)

		const owner: string = await sa.owner()
		const operator: string = await sa.operator()
		const [maxSlippageBps, minTradeAmount, settlementAddress] = await sa.rules()
		const targetTokens: string[] = await sa.targetTokens()

		console.log(`smartAccount      : ${args.sa}`)
		console.log(`owner             : ${owner}`)
		console.log(`operator          : ${operator}`)
		console.log(`maxSlippageBps    : ${maxSlippageBps}`)
		console.log(`minTradeAmount    : ${minTradeAmount.toString()}`)
		console.log(`settlementAddress : ${settlementAddress}`)
		console.log(`targetTokens      : [${targetTokens.join(', ')}]`)

		const tokens = (args.tokens as string)
			.split(',')
			.map(t => t.trim())
			.filter(Boolean)

		if (tokens.length === 0) return

		console.log('\nBalances:')
		for (const tokenAddr of tokens) {
			const t = new ethers.Contract(tokenAddr, ERC20_ABI, ethers.provider)
			const [bal, decimals, symbol] = await Promise.all([
				t.balanceOf(args.sa),
				t.decimals().catch(() => 18),
				t.symbol().catch(() => '???')
			])
			console.log(
				`  ${symbol.padEnd(8)} ${tokenAddr}  ${ethers.formatUnits(bal, decimals)}`
			)
		}
	})
