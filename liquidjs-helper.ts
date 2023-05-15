import {
  Extractor,
  Finalizer,
  Pset,
  PsetGlobal,
  Transaction,
  witnessStackToScriptWitness,
} from "liquidjs-lib";
import * as liquid from "liquidjs-lib";
import { internalKeypair, takerKeypair } from "./keys";
let ecc = require("tiny-secp256k1");
import { NETWORK } from "./constants";
import ElementsClient from "./elements-client";
import {
  IssueAssetResponse,
  SimplifiedVerboseGetRawTransactionResponse,
} from "./elements-client/module";
import { ECPairFactory } from "ecpair";
import { taggedHash } from "liquidjs-lib/src/crypto";
export interface SendResult {
  tx: SimplifiedVerboseGetRawTransactionResponse;
  outputIndex: number;
}

const elementsClient = new ElementsClient();

export async function issueAsset(
  amount: number,
  reissuanceTokenAmount: number = 0
): Promise<{ issuanceTxId: string; assetId: string }> {
  let issuanceResponse: IssueAssetResponse = await elementsClient.issueAsset(
    amount / 100_000_000,
    reissuanceTokenAmount
  );

  return {
    issuanceTxId: issuanceResponse.txid,
    assetId: issuanceResponse.asset,
  };
}

export function getCovenantAddress(
  covenantScriptASM: string,
  internalPublicKey: Buffer
): string {
  const leafScript = liquid.script.fromASM(covenantScriptASM);

  let leaves = [
    {
      scriptHex: leafScript.toString("hex"),
    },
  ];

  let hashTree = liquid.bip341.toHashTree(leaves);
  let bip341Factory = liquid.bip341.BIP341Factory(ecc);
  let output = bip341Factory.taprootOutputScript(internalPublicKey, hashTree);
  let p2trAddress = liquid.address.fromOutputScript(output, NETWORK);

  if (!p2trAddress) {
    throw new Error("Address could not be derived");
  }

  return p2trAddress;
}

let getOutputForAssetId = (tx, assetId: string) => {
  let { vout } = tx;

  for (let i = 0; i < vout.length; i++) {
    if (vout[i].asset == assetId && vout[i].scriptPubKey.asm) {
      return i;
    }
  }

  return -1;
};

function convertToBitcoinUnits(amount) {
  return amount / 100_000_000;
}

export async function spendToAddress({
  assetId,
  address,
  amount: amountInSatoshis,
}: {
  assetId: string;
  address: string;
  amount: number;
}): Promise<SendResult> {
  let sendToAddressTxId = await elementsClient.sendToAddress(
    address,
    convertToBitcoinUnits(amountInSatoshis),
    assetId
  );
  let tx = await elementsClient.getRawTransaction(sendToAddressTxId);
  let outputIndex = getOutputForAssetId(tx, assetId);

  return {
    tx,
    outputIndex,
  };
}

function toXOnly(key: Buffer) {
  return key.subarray(1);
}

const serializeSchnorrSig = (sig: Buffer, hashtype: number) =>
  Buffer.concat([
    sig,
    hashtype !== 0x00 ? Buffer.of(hashtype) : Buffer.alloc(0),
  ]);

function getTweakedSignature(messageHash, hash) {
  // Order of the curve (N) - 1
  const N_LESS_1 = Buffer.from(
    "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140",
    "hex"
  );

  // 1 represented as 32 bytes BE
  const ONE = Buffer.from(
    "0000000000000000000000000000000000000000000000000000000000000001",
    "hex"
  );

  const privateKey =
    internalKeypair.publicKey[0] === 2
      ? internalKeypair.privateKey
      : ecc.privateAdd(
          ecc.privateSub(N_LESS_1, internalKeypair.privateKey)!,
          ONE
        );

  const toTweak = Buffer.concat([toXOnly(internalKeypair.publicKey), hash]);
  const tweakHash = taggedHash("TapTweak/elements", toTweak);

  let newPrivateKey = ecc.privateAdd(privateKey, tweakHash);
  let signature = ecc.signSchnorr(messageHash, newPrivateKey, Buffer.alloc(32));

  const ok = ecc.verifySchnorr(
    messageHash,
    ECPairFactory(ecc)
      .fromPrivateKey(Buffer.from(newPrivateKey))
      .publicKey.slice(1),
    signature
  );
  if (!ok) throw new Error("Invalid Signature");

  return serializeSchnorrSig(signature, Transaction.SIGHASH_ALL);
}

export async function spendFromCovenant({
  covenantScript,
  inputs,
  outputs,
  internalPublicKey,
  assetId,
  keySpend = false
}: {
  covenantScript: Buffer;
  inputs: any;
  outputs: Array<any>;
  internalPublicKey: Buffer;
  assetId: string;
  keySpend?: boolean;
}): Promise<SendResult> {
  const TRANSACTION_VERSION = 2;
  let pset = new Pset(
    new PsetGlobal(TRANSACTION_VERSION, inputs.length, outputs.length),
    inputs,
    outputs
  );

  let leaves = [
    {
      scriptHex: covenantScript.toString("hex"),
    },
  ];

  let leafHash = liquid.bip341.tapLeafHash(leaves[0]);
  let hashTree = liquid.bip341.toHashTree(leaves);
  const bip341Factory = liquid.bip341.BIP341Factory(ecc);

  // Path will always be '[]' since we only have one script in tree
  let path = liquid.bip341.findScriptPath(hashTree, leafHash);

  if (!keySpend) {
    let taprootStack = bip341Factory.taprootSignScriptStack(
      internalPublicKey,
      leaves[0],
      hashTree.hash,
      path
    );

    pset.inputs[0].finalScriptWitness = witnessStackToScriptWitness([
      ...taprootStack,
    ]);
  } else {
    const input0Preimage = pset.getInputPreimage(
      0,
      Transaction.SIGHASH_ALL,
      NETWORK.genesisBlockHash
    );

    const signature = getTweakedSignature(input0Preimage, hashTree.hash);

    pset.inputs[0].finalScriptWitness = witnessStackToScriptWitness([
      signature,
    ]);
  }

  const input1Preimage = pset.getInputPreimage(
    1,
    Transaction.SIGHASH_ALL,
    NETWORK.genesisBlockHash
  );

  pset.inputs[1].partialSigs = [];
  pset.inputs[1].partialSigs.push({
    pubkey: takerKeypair.publicKey,
    signature: liquid.script.signature.encode(
      takerKeypair.sign(input1Preimage),
      Transaction.SIGHASH_ALL
    ),
  });

  let finalizer = new Finalizer(pset);
  finalizer.finalizeInput(1);

  const input2Preimage = pset.getInputPreimage(
    2,
    Transaction.SIGHASH_ALL,
    NETWORK.genesisBlockHash
  );

  pset.inputs[2].partialSigs = [];
  pset.inputs[2].partialSigs.push({
    pubkey: takerKeypair.publicKey,
    signature: liquid.script.signature.encode(
      takerKeypair.sign(input2Preimage),
      Transaction.SIGHASH_ALL
    ),
  });

  finalizer.finalizeInput(2);

  const tx = Extractor.extract(pset);
  const hex = tx.toHex();
  return broadcastTx(hex, assetId);
}

export async function broadcastTx(
  tx: string,
  assetId: string
): Promise<SendResult> {
  try {
    let txid: string = await elementsClient
      .getRawClient()
      .request("sendrawtransaction", {
        hexstring: tx,
      });

    console.log(`Successfully broadcast transaction: ${txid}\n\n`);

    try {
      let address = await elementsClient
        .getRawClient()
        .request("getnewaddress");

      await elementsClient.getRawClient().request("generatetoaddress", {
        address: address,
        nblocks: 10,
      });
    } catch (err) {
      console.log("Error generating blocks");
    }

    let verboseGetRawTransactionResponse =
      await elementsClient.getRawTransaction(txid);
    let outputIndex = getOutputForAssetId(
      verboseGetRawTransactionResponse,
      assetId
    );

    return {
      tx: verboseGetRawTransactionResponse,
      outputIndex,
    };
  } catch (err) {
    console.log("\n\n", (err as any).message, "\n\n");
    return Promise.reject();
  }
}
