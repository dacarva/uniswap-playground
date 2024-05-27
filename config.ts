import { Token } from "@uniswap/sdk-core";
import { FeeAmount } from "@uniswap/v3-sdk";
import { USDC_TOKEN, COPM_TOKEN } from "./constants";

export interface BaseConfig {
	rpc: {
		local: string;
		mainnet: string;
	};
	tokens: {
		in: Token;
		amountIn: number;
		out: Token;
		poolFee: number;
	};
}

export const CurrentConfig: BaseConfig = {
	rpc: {
		local: "http://localhost:8545",
		mainnet: `https://polygon-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`,
	},
	tokens: {
		in: COPM_TOKEN,
		amountIn: 10000,
		out: USDC_TOKEN,
		poolFee: FeeAmount.MEDIUM,
	},
};
