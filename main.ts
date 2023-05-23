import * as liquid from "liquidjs-lib";
import {
  issueAsset,
  getCovenantAddress,
  spendToAddress as spendToAddress,
  spendFromCovenant,
  SendResult,
  toXOnly,
} from "./liquidjs-helper";
import { keypair, recipientKeypair } from "./keys";
import {
  INTERNAL_PUBLIC_KEY,
  ISSUANCE_AMOUNT_IN_SATOSHIS,
  LBTC_ASSET_ID,
  LEAF_VERSION_HEX,
  NETWORK,
  ROYALTY_ADDRESS,
  TRANSACTION_FEE_IN_SATOSHIS,
} from "./constants";
import { createInput } from "./utils";
import * as pushdata from "liquidjs-lib/src/push_data";

function getC(royaltyAmountInSatoshis: bigint) {
  const royaltyFeeAmountBuffer = Buffer.allocUnsafe(8);
  royaltyFeeAmountBuffer.writeBigInt64LE(royaltyAmountInSatoshis);

  const liquidBtc = Buffer.from(LBTC_ASSET_ID, "hex").reverse().toString("hex");
  const royaltyFeeAmount = royaltyFeeAmountBuffer.toString("hex");

  //Push the nAsset of the current index onto the stack as two elements.
  //The first push the assetID(32), followed by the prefix(1)
  let OP_INSPECTCURRENTINPUTASSET = `OP_PUSHCURRENTINPUTINDEX OP_INSPECTINPUTASSET`;
  let OP_INSPECTCURRENTINPUTVALUE = `OP_PUSHCURRENTINPUTINDEX OP_INSPECTINPUTVALUE`;

  //skip first byte (witness version) and second byte (push data size) using 'subarray'
  let outputScript = liquid.address
    .toOutputScript(ROYALTY_ADDRESS)
    .subarray(2)
    .toString("hex");

  return (
    `OP_1 OP_INSPECTOUTPUTASSET OP_DROP ${liquidBtc} OP_EQUALVERIFY ` +
    `OP_1 OP_INSPECTOUTPUTVALUE OP_DROP ${royaltyFeeAmount} OP_EQUALVERIFY ` +
    `OP_1 OP_INSPECTOUTPUTSCRIPTPUBKEY OP_DROP ${outputScript} OP_EQUALVERIFY ` +
    //Check the royalty asset output
    `OP_PUSHCURRENTINPUTINDEX OP_INSPECTOUTPUTASSET OP_DROP ${OP_INSPECTCURRENTINPUTASSET} OP_DROP OP_EQUALVERIFY ` +
    `OP_PUSHCURRENTINPUTINDEX OP_INSPECTOUTPUTVALUE OP_DROP ${OP_INSPECTCURRENTINPUTVALUE} OP_DROP OP_EQUAL`
  );
}

//{parity} {index} {output_script} {internal pubkey} OP_FORCE_OUTPUT_SCRIPT_VERIFY
function OP_FORCE_OUTPUT_SCRIPT_VERIFY(): string {
  let storeCopyOfXOnlyInternalPubkeyOnAltStack = `OP_DUP OP_TOALTSTACK`;

  //  let hashIntoTweakAndMoveToAltStack = `${Buffer.from("TapTweak/elements").reverse().toString("hex")} OP_SHA256 OP_SHA256 ${Buffer.from("TapLeaf/elements").reverse().toString("hex")} OP_SHA256 OP_SHA256 OP_SHA256 OP_CAT OP_SHA256 OP_TOALTSTACK`;
  const tweakConstant = `${Buffer.from("TapTweak/elements").toString(
    "hex"
  )} OP_SHA256 OP_DUP OP_CAT`;
  const leafConstant = `${Buffer.from("TapLeaf/elements").toString(
    "hex"
  )} OP_SHA256 OP_DUP OP_CAT`;
  let createTweakMessagePrefix = `${tweakConstant} OP_SWAP OP_CAT`;
  //The OP_CAT is preventing this from passing, it exceeds (MAX_SCRIPT_ELEMENT_SIZE=520 bytes). We have 552
  let createTapLeafHashMessage = `${leafConstant} ${LEAF_VERSION_HEX} OP_CAT OP_2 OP_ROLL OP_CAT`;
  let hashIntoTweakAndMoveToAltStack = `${createTweakMessagePrefix} ${createTapLeafHashMessage} OP_SHA256 OP_CAT OP_SHA256 OP_TOALTSTACK`;

  let validateTweakFromAltStack = `OP_INSPECTOUTPUTSCRIPTPUBKEY OP_VERIFY OP_CAT OP_FROMALTSTACK OP_FROMALTSTACK OP_TWEAKVERIFY`;

  return (
    `${storeCopyOfXOnlyInternalPubkeyOnAltStack} ` +
    `${hashIntoTweakAndMoveToAltStack} ` +
    `${validateTweakFromAltStack}`
  );
}

function getCheckSigScript(recipientPublicKey) {
  return `${recipientPublicKey.slice(2)} OP_CHECKSIGVERIFY`;
}

async function main() {
  const createOutputScriptEnd = `OP_SWAP OP_DUP OP_CAT OP_CAT`;
  const ROYALTY_IN_SATOSHIS = 500;

  let scriptEnd = `${createOutputScriptEnd} OP_CAT OP_PUSHCURRENTINPUTINDEX OP_SWAP ${toXOnly(
    INTERNAL_PUBLIC_KEY
  ).toString("hex")} ${OP_FORCE_OUTPUT_SCRIPT_VERIFY()} ${getC(
    BigInt(ROYALTY_IN_SATOSHIS)
  )}`;

  let scriptSize = liquid.script.fromASM(scriptEnd).length;

  //this is the number of bytes needed to represent the size of the script according to pushdata rules
  let encodedScriptLengthBufferSize = pushdata.encodingLength(scriptSize);

  // This is the number of bytes needed to represent the size of the size of the script
  const encodedScriptLengthBufferSizePushDataPrefixSize =
    pushdata.encodingLength(encodedScriptLengthBufferSize);

  // This is the total size of the script, the original size prefix for the script,
  // and the size of the sizeHex that we're now adding to the script (respectively)
  let scriptLengthWithPushDataPrefix =
    scriptSize +
    encodedScriptLengthBufferSizePushDataPrefixSize +
    encodedScriptLengthBufferSize;

  let scriptLengthWithPushDataPrefixBuffer = Buffer.alloc(
    pushdata.encodingLength(scriptLengthWithPushDataPrefix)
  );

  pushdata.encode(
    scriptLengthWithPushDataPrefixBuffer,
    scriptLengthWithPushDataPrefix,
    0
  );
  let sizeHex = scriptLengthWithPushDataPrefixBuffer.toString("hex");

  scriptEnd = `${sizeHex} ${scriptEnd}`;

  let serializedDestinationScriptEnd = liquid.script
    .fromASM(scriptEnd)
    .toString("hex");

  scriptEnd = `${serializedDestinationScriptEnd} ${scriptEnd}`;

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
    amount: TRANSACTION_FEE_IN_SATOSHIS + ROYALTY_IN_SATOSHIS,
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

  // Make the next covenant we spend to commit to a 'fullScript' 
  // containing a checksig before the recursive portion of the script is run.
  const scriptStart = `${getCheckSigScript(
    recipientKeypair.publicKey.toString("hex")
  )}`;
  const fullScript = `${scriptStart} ${scriptEnd}`.trim();

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
      ROYALTY_IN_SATOSHIS,
      Buffer.from(LBTC_ASSET_ID, "hex").reverse(),
      liquid.address.toOutputScript(ROYALTY_ADDRESS)
    ),
    new liquid.PsetOutput(
      TRANSACTION_FEE_IN_SATOSHIS,
      Buffer.from(LBTC_ASSET_ID, "hex").reverse(),
      Buffer.alloc(0)
    ),
  ];

  let spendFromCovenantSendResult = await spendFromCovenant({
    covenantScript: liquid.script.fromASM(scriptEnd),
    inputs,
    outputs,
    internalPublicKey: INTERNAL_PUBLIC_KEY,
    spendFromCovenantDestinationScriptStart: scriptStart
      ? liquid.script.fromASM(scriptStart)
      : Buffer.from([]),
    assetId,
    fullScript: liquid.script.fromASM(fullScript),
  });

  console.log(
    `Successfully made first spend from covenant: ${spendFromCovenantSendResult.tx.txid}`
  );

  /************************/

  console.log("Sending LBTC to test address again...");
  covenantFundingSpendResult = await spendToAddress({
    assetId: LBTC_ASSET_ID,
    address: keypairAddress!,
    amount: TRANSACTION_FEE_IN_SATOSHIS + ROYALTY_IN_SATOSHIS,
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
      ROYALTY_IN_SATOSHIS,
      Buffer.from(LBTC_ASSET_ID, "hex").reverse(),
      liquid.address.toOutputScript(ROYALTY_ADDRESS)
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
    spendFromCovenantDestinationScriptStart: scriptStart
      ? liquid.script.fromASM(scriptStart)
      : Buffer.from([]),
    assetId,
    fullScript: liquid.script.fromASM(fullScript),
    signingKeypair: recipientKeypair,
  });

  console.log(
    `Successfully made second spend from covenant: ${spendFromCovenantSendResult.tx.txid}`
  );

  console.log("DONE");
}

main();
