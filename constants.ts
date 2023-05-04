import * as crypto from "crypto";
import * as liquid from "liquidjs-lib";
import { internalKeypair } from "./keys";
import { LEAF_VERSION_TAPSCRIPT } from "liquidjs-lib/src/bip341";

function sha256(data: Buffer) {
  return crypto.createHash("sha256").update(data).digest();
}

const TapLeafElementsTag = "TapLeaf/elements";
const TapLeafTaggedHashPrefix = Buffer.concat([
  sha256(Buffer.from(TapLeafElementsTag, "ascii")),
  sha256(Buffer.from(TapLeafElementsTag, "ascii")),
]);

const TapTweakElementsTag = "TapTweak/elements";
const TapTweakTaggedHashPrefix = Buffer.concat([
  sha256(Buffer.from(TapTweakElementsTag, "ascii")),
  sha256(Buffer.from(TapTweakElementsTag, "ascii")),
]);

export const TapLeafTaggedHashPrefixHex =
  TapLeafTaggedHashPrefix.toString("hex");
export const TapTweakTaggedHashPrefixHex =
  TapTweakTaggedHashPrefix.toString("hex");
export const LEAF_VERSION_HEX = LEAF_VERSION_TAPSCRIPT.toString(16);

export const ISSUANCE_AMOUNT_IN_SATOSHIS = 1;
export const TRANSACTION_FEE_IN_SATOSHIS = 500;

export const NETWORK = liquid.networks.regtest;
export const LBTC_ASSET_ID = NETWORK.assetHash;
export const INTERNAL_PUBLIC_KEY: Buffer = internalKeypair.publicKey;
