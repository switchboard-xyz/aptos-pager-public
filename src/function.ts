import { AptosClient, AptosAccount, HexString, CoinClient } from "aptos";
import PdClient from "node-pagerduty";
import { HttpFunction } from "@google-cloud/functions-framework/build/src/functions";
import { AggregatorAccount } from "@switchboard-xyz/aptos.js";
const fetch = require("node-fetch");
// https://www.npmjs.com/package/@google-cloud/secret-manager
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import * as bs58 from "bs58";
import * as sbv2 from "@switchboard-xyz/switchboard-v2";

const NODE_URL = process.env.NODE_URL;
const SWITCHBOARD_ADDRESS = process.env.SWITCHBOARD_ADDRESS;
//"0x7d7e436f0b2aafde60774efb26ccc432cf881b677aca7faaf2a01879bd19fb8";
// TODO: MAKE THIS THE AUTHORITY THAT WILL OWN THE ORACLE
//0x9190d0fad0520ef650caa1ef8bd89da660d6eb617feabd618039b9c6bf11e802
const QUEUE_ADDRESS = process.env.QUEUE_ADDRESS;
//"0x11fbd91e4a718066891f37958f0b68d10e720f2edf8d57854fb20c299a119a8c";
//0x9190d0fad0520ef650caa1ef8bd89da660d6eb617feabd618039b9c6bf11e802

async function accountBalance(
  client: AptosClient,
  address: string
): Promise<Number> {
  const out = await client.getAccountResource(
    address,
    "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
  );

  return Number((out.data as any).coin.value) / 100000000;
}

async function sendPage(aggregator: any, e: string) {
  let routingKey = process.env.PAGERDUTY_KEY
  let pdClient = new PdClient(routingKey);
  let customDetails = {
    group: "ABC",
    error: e,
    aggregator: aggregator,
  };
  let severity = "critical";
  // if (cluster.toString().includes("devnet")) {
  // severity = "info";
  // }
  let payload = {
    payload: {
      summary: "Aptos Alert v2: ", //+ cluster.toString(),
      timestamp: new Date().toISOString(),
      source: aggregator.toString(),
      severity,
      group: "ABC", //cluster.toString(),
      custom_details: customDetails,
    },
    routing_key: routingKey,
    event_action: "trigger",
    client: "ABC",
  };
  console.log("Event sending to pagerduty:", payload);
  await pdClient.events.sendEvent(payload);
}

async function checkFeedHealth(
  address: string,
  minTillStale: number
): Promise<any> {
  const client = new AptosClient(NODE_URL);
  const feedAccount = new AggregatorAccount(
    client,
    address,
    SWITCHBOARD_ADDRESS
  );
  const feed = await feedAccount.loadData();
  const threshold = minTillStale * 60;
  const now = +new Date() / 1000;
  const staleness =
    now - feed.latestConfirmedRound?.roundOpenTimestamp.toNumber();
  // const threshold = minTillStale * 60;
  let page = false;
  if (staleness > threshold) {
    page = true;
    await sendPage(address, "Feed is stale");
  }
  return { staleness, threshold, page };
}

export const pager: HttpFunction = async (req, res) => {
  try {
    const address = req.query.address!.toString();
    const minTillStale = +(req.query.minTillStale ?? "10");
    res.send(JSON.stringify(await checkFeedHealth(address, minTillStale)));
    const client = new AptosClient(NODE_URL);
    const turnerVal = await accountBalance(
      client,
      "0xca62eccbbdb22b5de18165d0bdf2d7127569b91498f0a7f6944028793cef8137"
    );
    let oracleVal: Number
    if (process.env.CLUSTER != "testnet") {
      oracleVal = await accountBalance(
        client,
        "0xf92bc956b9e25f38a2e4829b58f03ca9724233985cdda3f818bc3e62d6ed7d9c"
      );
    } else {
      oracleVal = 1;
    }
    const permissionlessracleVal = await accountBalance(
      client,
      "0xef84c318543882400c4498c81759e18084a1a5f820bfc683e6f53e3daeb449e2"
    );
    if (turnerVal < 1 || oracleVal < 1 || permissionlessracleVal < 1) {
      await sendPage("FUND", "FUND INFRA");
    }
  } catch (e) {
    await sendPage(e.stack.toString(), "Pager failure");
    res.send(`${e.stack.toString()}`);
  }
  return;
};

async function main() {
  await checkFeedHealth(
    "0x1f7b23e6d81fa2102b2e994d2e54d26d116426c7dda5417925265f7b46f50c73",
    1
  );
}

(async () => {
  await main();
})();
