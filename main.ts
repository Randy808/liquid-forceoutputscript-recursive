import * as liquid from "liquidjs-lib";
import {
  issueAsset,
  getCovenantAddress,
  spendToAddress as spendToAddress,
  spendFromCovenant,
  SendResult,
  toXOnly,
} from "./liquidjs-helper";
import { keypair } from "./keys";
import {
  INTERNAL_PUBLIC_KEY,
  ISSUANCE_AMOUNT_IN_SATOSHIS,
  LBTC_ASSET_ID,
  LEAF_VERSION_HEX,
  NETWORK,
  TRANSACTION_FEE_IN_SATOSHIS,
  TapLeafTaggedHashPrefixHex,
  TapTweakTaggedHashPrefixHex,
} from "./constants";
import { createInput } from "./utils";
import * as pushdata from "liquidjs-lib/src/push_data";

//{parity} {index} {output_script} {internal pubkey} OP_FORCE_OUTPUT_SCRIPT_VERIFY
function OP_FORCE_OUTPUT_SCRIPT_VERIFY(): string {
  let storeCopyOfXOnlyInternalPubkeyOnAltStack = `OP_DUP OP_TOALTSTACK`;

  let createTweakMessagePrefix = `${TapTweakTaggedHashPrefixHex} OP_SWAP OP_CAT`;
  let createTapLeafHashMessage = `${TapLeafTaggedHashPrefixHex}${LEAF_VERSION_HEX} OP_2 OP_ROLL OP_CAT`;
  let hashIntoTweakAndMoveToAltStack = `${createTweakMessagePrefix} ${createTapLeafHashMessage} OP_SHA256 OP_CAT OP_SHA256 OP_TOALTSTACK`;

  let validateTweakFromAltStack = `OP_INSPECTOUTPUTSCRIPTPUBKEY OP_VERIFY OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_TWEAKVERIFY`;

  return (
    `${storeCopyOfXOnlyInternalPubkeyOnAltStack} ` +
    `${hashIntoTweakAndMoveToAltStack} ` +
    `${validateTweakFromAltStack}`
  );
}

async function main() {
  const createOutputScriptEnd = `OP_SWAP OP_DUP OP_CAT OP_CAT`;

  let scriptEnd = `${createOutputScriptEnd} OP_CAT ${toXOnly(
    INTERNAL_PUBLIC_KEY
  ).toString("hex")} ${OP_FORCE_OUTPUT_SCRIPT_VERIFY()} OP_1`;

  let scriptSize = liquid.script.fromASM(
    scriptEnd
  ).length;

  //this is the number of bytes needed to represent the size of the script according to pushdata rules
  let encodedScriptLengthBufferSize = pushdata.encodingLength(scriptSize);
  
  // This is the number of bytes needed to represent the size of the size of the script
  const encodedScriptLengthBufferSizePushDataPrefixSize = pushdata.encodingLength(encodedScriptLengthBufferSize);

  // This is the total size of the script, the original size prefix for the script, 
  // and the size of the sizeHex that we're now adding to the script (respectively)
  let scriptLengthWithPushDataPrefix =
    scriptSize + encodedScriptLengthBufferSizePushDataPrefixSize + encodedScriptLengthBufferSize ;

  let scriptLengthWithPushDataPrefixBuffer = Buffer.alloc(
    pushdata.encodingLength(scriptLengthWithPushDataPrefix)
  );

  pushdata.encode(scriptLengthWithPushDataPrefixBuffer, scriptLengthWithPushDataPrefix, 0);
  let sizeHex = scriptLengthWithPushDataPrefixBuffer.toString("hex");

  scriptEnd = `${sizeHex} ${scriptEnd}`;

  let serializedDestinationScriptEnd = liquid.script
    .fromASM(scriptEnd)
    .toString("hex");

  scriptEnd = `${serializedDestinationScriptEnd} ${scriptEnd}`;

  const scriptStart = ``;

  /************************/

  console.log("Issuing new asset...");
  let { assetId } = await issueAsset(ISSUANCE_AMOUNT_IN_SATOSHIS);
  console.log(`Generated asset id ${assetId}\n\n`);

  /************************/

  console.log("Creating covenant address...");

  let covenantAddress = await getCovenantAddress(
    scriptEnd.trim(),
    INTERNAL_PUBLIC_KEY
  );

  /************************/

  console.log("Spending to covenant...");
  let spendToCovenantTx: SendResult = await spendToAddress({
    assetId: assetId,
    address: covenantAddress,
    amount: ISSUANCE_AMOUNT_IN_SATOSHIS,
  });
  console.log(
    `Sent asset to covenant address: ${covenantAddress}\nTxid: ${spendToCovenantTx.tx.txid}\n\n`
  );

  /************************/

  console.log("Sending LBTC to test address...");
  let { address: keypairAddress } = liquid.payments.p2wpkh({
    pubkey: keypair.publicKey,
    network: NETWORK,
  });
  let covenantFundingSpendResult: SendResult = await spendToAddress({
    assetId: LBTC_ASSET_ID,
    address: keypairAddress!,
    amount: 500,
  });
  console.log(
    `sendToAddress (BTC) result: ${covenantFundingSpendResult.tx.txid}\n\n`
  );

  /************************/

  console.log("Spending from covenant...");
  let inputs: any = [];

  // Any changes to the order here will require changes in 'spendFromCovenant'.
  inputs.push(createInput(spendToCovenantTx));
  inputs.push(createInput(covenantFundingSpendResult));

  const fullScript =
    `${scriptStart} ${scriptEnd}`.trim();

  let spendFromCovenantDestinationScriptAddress = await getCovenantAddress(
    fullScript,
    INTERNAL_PUBLIC_KEY
  );

  let outputs = [
    new liquid.PsetOutput(
      ISSUANCE_AMOUNT_IN_SATOSHIS,
      Buffer.from(assetId, "hex").reverse(),
      liquid.address.toOutputScript(spendFromCovenantDestinationScriptAddress)
    ),
    new liquid.PsetOutput(
      TRANSACTION_FEE_IN_SATOSHIS,
      Buffer.from(LBTC_ASSET_ID, "hex").reverse(),
      Buffer.alloc(0)
    ),
  ];

  let spendFromCovenantSendResult = await spendFromCovenant({
    covenantScript: liquid.script.fromASM(
      scriptEnd
    ),
    inputs,
    outputs,
    internalPublicKey: INTERNAL_PUBLIC_KEY,
    spendFromCovenantDestinationScriptStart:
      scriptStart
        ? liquid.script.fromASM(scriptStart)
        : Buffer.from([]),
    assetId,
    fullScript: liquid.script.fromASM(fullScript),
  });

  console.log(`Successfully made first spend from covenant: ${spendFromCovenantSendResult.tx.txid}`);

  /************************/

  console.log("Sending LBTC to test address again...");
  covenantFundingSpendResult = await spendToAddress({
    assetId: LBTC_ASSET_ID,
    address: keypairAddress!,
    amount: 500,
  });

  console.log(
    `sendToAddress (BTC) result: ${covenantFundingSpendResult.tx.txid}\n\n`
  );

  /************************/

  console.log("Spending from covenant again...");
  inputs = [];
  // Any changes to the order here will require changes in 'spendFromCovenant'.
  inputs.push(createInput(spendFromCovenantSendResult));
  inputs.push(createInput(covenantFundingSpendResult));

  spendFromCovenantDestinationScriptAddress = await getCovenantAddress(
    fullScript,
    INTERNAL_PUBLIC_KEY
  );

  outputs = [
    new liquid.PsetOutput(
      ISSUANCE_AMOUNT_IN_SATOSHIS,
      Buffer.from(assetId, "hex").reverse(),
      liquid.address.toOutputScript(spendFromCovenantDestinationScriptAddress)
    ),
    new liquid.PsetOutput(
      TRANSACTION_FEE_IN_SATOSHIS,
      Buffer.from(LBTC_ASSET_ID, "hex").reverse(),
      Buffer.alloc(0)
    ),
  ];

  spendFromCovenantSendResult = await spendFromCovenant({
    covenantScript: liquid.script.fromASM(fullScript),
    inputs,
    outputs,
    internalPublicKey: INTERNAL_PUBLIC_KEY,
    spendFromCovenantDestinationScriptStart:
      scriptStart
        ? liquid.script.fromASM(scriptStart)
        : Buffer.from([]),
    assetId,
    fullScript: liquid.script.fromASM(fullScript),
  });

  console.log(
    `Successfully made second spend from covenant: ${spendFromCovenantSendResult.tx.txid}`
  );

  console.log("DONE");
}

main();
