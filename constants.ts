import * as liquid from "liquidjs-lib";
import { internalKeypair } from "./keys";

export const ISSUANCE_AMOUNT_IN_SATOSHIS = 1000;
export const LBTC_OFFER_AMOUNT = 5000;
export const TRANSACTION_FEE_IN_SATOSHIS = 400;

export const NETWORK = liquid.networks.regtest;
export const LBTC_ASSET_ID = NETWORK.assetHash;
export const INTERNAL_PUBLIC_KEY: Buffer = internalKeypair.publicKey;