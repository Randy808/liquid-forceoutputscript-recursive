import * as liquid from "liquidjs-lib";
import { Transaction } from "liquidjs-lib";
import { SendResult } from "./liquidjs-helper";

// Always remember to fix rounding in js: https://techformist.com/problems-with-decimal-multiplication-javascript/
// https://stackoverflow.com/questions/9993266/javascript-multiply-not-precise
export function fixRounding(value, precision) {
  var power = Math.pow(10, precision || 0);
  return Math.round(value * power) / power;
}

export function createInput(sendResult: SendResult) {
  let tx = sendResult.tx;

  // Reverse because PsetInput takes in txid in little-endian
  let psetInput = new liquid.PsetInput(
    Buffer.from(tx.txid, "hex").reverse(),
    sendResult.outputIndex,
    Transaction.DEFAULT_SEQUENCE
  );

  let utxo = tx.vout[sendResult.outputIndex];

  let nonce = Buffer.from("00", "hex");

  psetInput.witnessUtxo = {
    asset: Buffer.concat([
      Buffer.from("01", "hex"),
      Buffer.from(utxo.asset, "hex").reverse(),
    ]),
    script: Buffer.from(utxo.scriptPubKey.hex, "hex"),
    value: liquid.confidential.satoshiToConfidentialValue(
      // utxo.value is denominated in Bitcoin so it must be converted to a satoshi count
      fixRounding(utxo.value * 100_000_000, 0)
    ),
    nonce,
  };

  psetInput.sighashType = Transaction.SIGHASH_ALL;

  return psetInput;
}
