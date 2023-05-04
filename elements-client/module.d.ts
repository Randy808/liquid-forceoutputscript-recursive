export interface IssueAssetResponse {
  txid: string;
  vin: number;
  entropy: string;
  asset: string;
  token: string;
}

export interface GetBalanceResponse {
  [asset: string]: number;
}



export interface SimplifiedVerboseGetRawTransactionResponse {
  txid: string;
  vin: any[];
  vout: any[];
  fee: {[assetId: string]: number}
}