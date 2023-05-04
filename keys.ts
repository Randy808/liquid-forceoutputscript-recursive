import { ECPairFactory } from "ecpair";
let ecc = require("tiny-secp256k1");
let ECPair = ECPairFactory(ecc);

//TEST PRIVATE KEY. NEVER USE FOR SERIOUS PURPOSES.
let privateKeyHex = Buffer.from(
  "968f91395a8d682e5e3dd4a4f19465f1d9122cbbe82a5a624d863c39513a4eed",
  "hex"
);

let recipientPrivateKey = Buffer.from(
  "e30fe5eaa2a46119b706d5ffa974549c9a19a832ace7438112d20f452e3376fa",
  "hex"
);

let internalPrivateKey = Buffer.from("06f4f2c32662bb1638b7764a6f9dac5e647a66ffad1cbeec9edaf2564b0c024e", "hex")

let keypair = ECPair.fromPrivateKey(privateKeyHex);
let recipientKeypair = ECPair.fromPrivateKey(recipientPrivateKey);
let internalKeypair = ECPair.fromPrivateKey(internalPrivateKey);

function getRandomKeypair(){
  return ECPair.makeRandom();
}

export { keypair, recipientKeypair, internalKeypair, getRandomKeypair };
