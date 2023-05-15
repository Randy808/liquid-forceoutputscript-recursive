import * as liquid from "liquidjs-lib";
import {
  issueAsset,
  getCovenantAddress,
  spendToAddress as spendToAddress,
  spendFromCovenant,
  SendResult,
} from "./liquidjs-helper";
import { makerKeypair, takerKeypair } from "./keys";
import {
  INTERNAL_PUBLIC_KEY,
  LBTC_OFFER_AMOUNT,
  ISSUANCE_AMOUNT_IN_SATOSHIS,
  LBTC_ASSET_ID,
  NETWORK,
  TRANSACTION_FEE_IN_SATOSHIS,
} from "./constants";
import { createInput } from "./utils";

function getOutputAssetCheck(assetId: string) {
  let littleEndianAssetId = Buffer.from(assetId, "hex")
    .reverse()
    .toString("hex");

  return `OP_PUSHCURRENTINPUTINDEX OP_INSPECTOUTPUTASSET OP_DROP ${littleEndianAssetId} OP_EQUALVERIFY`;
}

function getOutputValueCheck(desiredSwapAmountInSatoshis: number) {
  const desiredSwapAmount = Buffer.allocUnsafe(8);
  desiredSwapAmount.writeBigInt64LE(BigInt(desiredSwapAmountInSatoshis));
  const desiredSwapAmountHex = desiredSwapAmount.toString("hex");

  return `OP_PUSHCURRENTINPUTINDEX OP_INSPECTOUTPUTVALUE OP_DROP ${desiredSwapAmountHex} OP_EQUALVERIFY`;
}

function getOutputScriptpubkeyCheckASM() {
  let { output } = liquid.payments.p2wpkh({
    pubkey: makerKeypair.publicKey,
  });

  //skip first byte (witness version) and second byte (push data size) using 'subarray'
  let outputScript = output!
    .subarray(2)
    .toString("hex");

  return `OP_PUSHCURRENTINPUTINDEX OP_INSPECTOUTPUTSCRIPTPUBKEY OP_DROP ${outputScript} OP_EQUALVERIFY`;
}

function getCovenantScript(assetId: string) {
  let checkOutputAsset = getOutputAssetCheck(assetId);
  let checkOutputValue = getOutputValueCheck(ISSUANCE_AMOUNT_IN_SATOSHIS);
  let checkOutputScript = getOutputScriptpubkeyCheckASM();

  return `${checkOutputAsset} ${checkOutputValue} ${checkOutputScript} OP_TRUE`;
}

async function main() {
  /*
  This program creates a covenant that facilitates a swap 
  from LBTC to a newly generated asset.

  The steps are as follows:
  1) Issue a new asset
  2) Create a covenant with a spending condition
     enforcing an asset payout to an address we
     own (derived from 'makerKeypair')
  3) Send LBTC from our elements node to a covenant-derived address
  4) Send LBTC from our elements node to the taker's p2wpkh address to cover fees
  5) Send asset to taker's p2wpkh address for swap
  6) Spend from covenant
  */

  // 1) Issue a new asset
  console.log("Issuing new asset...");
  let { assetId } = await issueAsset(ISSUANCE_AMOUNT_IN_SATOSHIS);
  console.log(`Generated asset id ${assetId}\n\n`);

  /************************/

  // 2) Create a covenant with a spending condition
  //    enforcing an asset payout to an address we
  //    own (derived from 'makerKeypair')

  console.log("Creating covenant address...");
  let script = getCovenantScript(assetId);
  let covenantAddress = await getCovenantAddress(
    script.trim(),
    INTERNAL_PUBLIC_KEY
  );

  /************************/

  // 3) Send LBTC from our elements node to a covenant-derived address
  console.log(
    "Sending LBTC from our elements node to a covenant-derived address..."
  );
  let spendToCovenantTx: SendResult = await spendToAddress({
    assetId: LBTC_ASSET_ID,
    address: covenantAddress,
    amount: LBTC_OFFER_AMOUNT,
  });
  console.log(
    `Sent asset to covenant address: ${covenantAddress}\nTxid: ${spendToCovenantTx.tx.txid}\n\n`
  );

  /************************/

  // 4) Send LBTC from our elements node to the taker's p2wpkh address to cover fees
  console.log(
    "Sending LBTC from our elements node to the taker's p2wpkh address to cover fees..."
  );
  let { address: takerAddress } = liquid.payments.p2wpkh({
    pubkey: takerKeypair.publicKey,
    network: NETWORK,
  });
  let covenantFundingSpendResult: SendResult = await spendToAddress({
    assetId: LBTC_ASSET_ID,
    address: takerAddress!,
    amount: TRANSACTION_FEE_IN_SATOSHIS,
  });
  console.log(
    `sendToAddress (BTC) result: ${covenantFundingSpendResult.tx.txid}\n\n`
  );

  /************************/

  // 5) Send asset to taker's p2wpkh address for swap
  console.log("Send asset to taker's p2wpkh address for swap...");

  let assetToExchangeSpendResult: SendResult = await spendToAddress({
    assetId: assetId,
    address: takerAddress!,
    amount: ISSUANCE_AMOUNT_IN_SATOSHIS,
  });
  console.log(
    `sendToAddress (${assetId}) result: ${assetToExchangeSpendResult.tx.txid}\n\n`
  );

  /************************/

  // 6) Spend from covenant
  console.log("Spending from covenant...");
  let inputs: any = [];

  // Any changes to the order here will require changes in 'spendFromCovenant'.
  inputs.push(createInput(spendToCovenantTx));
  inputs.push(createInput(covenantFundingSpendResult));
  inputs.push(createInput(assetToExchangeSpendResult));

  let { address: keypairAddress } = liquid.payments.p2wpkh({
    pubkey: makerKeypair.publicKey,
  });

  let outputs = [
    new liquid.PsetOutput(
      ISSUANCE_AMOUNT_IN_SATOSHIS,
      Buffer.from(assetId, "hex").reverse(),
      liquid.address.toOutputScript(keypairAddress!)
    ),
    new liquid.PsetOutput(
      LBTC_OFFER_AMOUNT,
      Buffer.from(LBTC_ASSET_ID, "hex").reverse(),
      liquid.address.toOutputScript(takerAddress!)
    ),
    new liquid.PsetOutput(
      TRANSACTION_FEE_IN_SATOSHIS,
      Buffer.from(LBTC_ASSET_ID, "hex").reverse(),
      Buffer.alloc(0)
    ),
  ];

  let spendFromCovenantSendResult = await spendFromCovenant({
    covenantScript: liquid.script.fromASM(script),
    inputs,
    outputs,
    internalPublicKey: INTERNAL_PUBLIC_KEY,
    assetId,
  });

  console.log(
    `Successfully made first spend from covenant: ${spendFromCovenantSendResult.tx.txid}`
  );

  console.log("DONE");
}

main();
