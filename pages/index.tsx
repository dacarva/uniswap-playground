import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { NextPage } from "next";
import Head from "next/head";
import styles from "../styles/Home.module.css";
import {
	computePoolAddress,
	Pool,
	Route,
	SwapOptions,
	Trade,
	SwapRouter,
} from "@uniswap/v3-sdk";
import { CurrencyAmount, TradeType, Percent } from "@uniswap/sdk-core";
import IUniswapV3PoolABI from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import Quoter from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json";

import {
  readContract,
	simulateContract,
	writeContract,
	sendTransaction,
	waitForTransactionReceipt,
} from "@wagmi/core";
import { useAccount } from "wagmi";
import { parseUnits, parseEther, erc20Abi, type Address } from "viem";
import JSBI from "jsbi";

import { CurrentConfig } from "../config";
import { wagmiConfig } from "./_app";
import {
	POOL_FACTORY_CONTRACT_ADDRESS,
	QUOTER_CONTRACT_ADDRESS,
	SWAP_ROUTER_ADDRESS,
	USDC_TOKEN,
	COPM_TOKEN,
} from "../constants";

interface PoolInfo {
	token0: string;
	token1: string;
	fee: number;
	liquidity: number;
	sqrtPriceX96: number;
	tick: number;
}

const USDC_AMOUNT = parseUnits("0.1", 6);
const COPM_AMOUNT = parseUnits("20000", 18);

const Home: NextPage = () => {
	const account = useAccount();

	const getPoolInfo = async (): Promise<PoolInfo> => {
		const currentPoolAddress = computePoolAddress({
			factoryAddress: POOL_FACTORY_CONTRACT_ADDRESS,
			tokenA: CurrentConfig.tokens.in,
			tokenB: CurrentConfig.tokens.out,
			fee: CurrentConfig.tokens.poolFee,
		}) as Address;

		const token0Promise = readContract(wagmiConfig, {
			abi: IUniswapV3PoolABI.abi,
			address: currentPoolAddress,
			functionName: "token0",
		});

		const token1Promise = readContract(wagmiConfig, {
			abi: IUniswapV3PoolABI.abi,
			address: currentPoolAddress,
			functionName: "token1",
		});

		const feePromise = readContract(wagmiConfig, {
			abi: IUniswapV3PoolABI.abi,
			address: currentPoolAddress,
			functionName: "fee",
		});

		const liquidityPromise = readContract(wagmiConfig, {
			abi: IUniswapV3PoolABI.abi,
			address: currentPoolAddress,
			functionName: "liquidity",
		});
		const slot0Promise = readContract(wagmiConfig, {
			abi: IUniswapV3PoolABI.abi,
			address: currentPoolAddress,
			functionName: "slot0",
		});

		const [token0, token1, fee, liquidity, slot0] = await Promise.all([
			token0Promise,
			token1Promise,
			feePromise,
			liquidityPromise,
			slot0Promise,
		]);

		return {
			token0: token0 as string,
			token1: token1 as string,
			fee: fee as number,
			liquidity: liquidity as number,
			sqrtPriceX96: (slot0 as number[])[0],
			tick: (slot0 as number[])[1],
		};
	};

	const getQuotedAmount = async (
		amount: bigint,
		poolInfo: PoolInfo
	): Promise<string | undefined> => {
		try {
			const quotedSimulation = await simulateContract(wagmiConfig, {
				abi: Quoter.abi,
				address: QUOTER_CONTRACT_ADDRESS,
				functionName: "quoteExactInputSingle",
				args: [COPM_TOKEN.address, USDC_TOKEN.address, poolInfo.fee, amount, 0],
			});
			return (quotedSimulation.result as string).toString();
		} catch (error) {
			console.error(error);
		}
	};

	const getSwapParameters = async (
		recipient: Address,
		poolInfo: PoolInfo,
		quotedAmount: string
	): Promise<{
		calldata: `0x${string}`;
		value: bigint;
	}> => {
		const COPM_CURRENCY_AMOUNT = CurrencyAmount.fromRawAmount(
			COPM_TOKEN,
			COPM_AMOUNT.toString()
		);
		// Token0 => COPM
		// Token1 => USDC

		/**
		 * Creates a new Pool object with the provided parameters.
		 *
		 * @param {string} inToken - The input token address.
		 * @param {string} outToken - The output token address.
		 * @param {number} poolFee - The pool fee.
		 * @param {string} sqrtPriceX96 - The square root of the price of the pool.
		 * @param {string} liquidity - The liquidity of the pool.
		 * @param {number} tick - The tick value of the pool.
		 * @returns {Pool} The newly created Pool object.
		 */

		const pool = new Pool(
      COPM_TOKEN,
			USDC_TOKEN,
			CurrentConfig.tokens.poolFee,
			poolInfo.sqrtPriceX96.toString(),
			poolInfo.liquidity.toString(),
			poolInfo.tick
		);

		/**
		 * Creates a new swap route using the specified pool, input token, and output token.
		 * @param {Pool} pool - The pool to use for the swap route.
		 * @param {Token} inputToken - The input token for the swap route.
		 * @param {Token} outputToken - The output token for the swap route.
		 * @returns {Route} - The newly created swap route.
		 */
		const swapRoute = new Route([pool], COPM_TOKEN, USDC_TOKEN);

		/**
		 * Creates an unchecked trade using the provided parameters.
		 *
		 * @param route - The swap route for the trade.
		 * @param inputAmount - The input amount for the trade.
		 * @param outputAmount - The output amount for the trade.
		 * @param tradeType - The type of trade.
		 * @returns The created unchecked trade.
		 */
		const uncheckedTrade = Trade.createUncheckedTrade({
			route: swapRoute,
			inputAmount: COPM_CURRENCY_AMOUNT,
			outputAmount: CurrencyAmount.fromRawAmount(
				USDC_TOKEN,
				JSBI.BigInt(quotedAmount)
			),
			tradeType: TradeType.EXACT_INPUT,
		});

		const swapOptions: SwapOptions = {
			slippageTolerance: new Percent(50, 10_000), // 50 bips, or 0.50%
			deadline: Math.floor(Date.now() / 1000) + 60 * 10, // 10 minutes from the current Unix time
			recipient,
		};

		const swapParameters = SwapRouter.swapCallParameters(
			[uncheckedTrade],
			swapOptions
		);
		return {
			calldata: swapParameters.calldata as `0x${string}`,
			value: parseEther(swapParameters.value),
		};
	};

	const trade = async () => {
		try {
			console.log("Getting quote");
			if (!account || !account.address) throw new Error("No account");

			const poolInfo = await getPoolInfo();

			const quotedAmount = await getQuotedAmount(COPM_AMOUNT, poolInfo);
			console.log("🚀 ~ getQuote ~ quotedAmount:", quotedAmount);

			if (!quotedAmount) throw new Error("No quoted amount");

			const swapParameters = await getSwapParameters(
				account.address,
				poolInfo,
				quotedAmount
			);

			const approvalTx = await writeContract(wagmiConfig, {
				abi: erc20Abi,
				address: COPM_TOKEN.address as Address,
				functionName: "approve",
				args: [SWAP_ROUTER_ADDRESS, COPM_AMOUNT],
			});

			await waitForTransactionReceipt(wagmiConfig, {
				hash: approvalTx,
			});

			const swapTx = await sendTransaction(wagmiConfig, {
				to: SWAP_ROUTER_ADDRESS,
				data: swapParameters.calldata,
				value: swapParameters.value,
			});

			const swapTxReceipt = await waitForTransactionReceipt(wagmiConfig, {
				hash: swapTx,
			});
			console.log("🚀 ~ getQuote ~ swapTxReceipt:", swapTxReceipt);
		} catch (error) {
			console.error(error);
		}
	};

	return (
		<div className={styles.container}>
			<Head>
				<title>RainbowKit App</title>
				<meta
					content="Generated by @rainbow-me/create-rainbowkit"
					name="description"
				/>
				<link href="/favicon.ico" rel="icon" />
			</Head>

			<main className={styles.main}>
				<ConnectButton />

				<h1 className={styles.title}>Welcome to Uniswap Playground</h1>

				<button onClick={trade}>Get quote and trade 10 lucas</button>
			</main>
		</div>
	);
};

export default Home;
