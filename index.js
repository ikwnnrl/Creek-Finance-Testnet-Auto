import chalk from "chalk";
import { SuiClient } from "@mysten/sui.js/client";
import { Ed25519Keypair } from "@mysten/sui.js/keypairs/ed25519";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { decodeSuiPrivateKey } from "@mysten/sui.js/cryptography";
import fs from "fs";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import axios from "axios";

const CREEK_RPC_URL = "https://fullnode.testnet.sui.io";
const USDC_TYPE = "0xa03cb0b29e92c6fa9bfb7b9c57ffdba5e23810f20885b4390f724553d32efb8b::usdc::USDC";
const GUSD_TYPE = "0x5434351f2dcae30c0c4b97420475c5edc966b02fd7d0bbe19ea2220d2f623586::coin_gusd::COIN_GUSD";
const XAUM_TYPE = "0xa03cb0b29e92c6fa9bfb7b9c57ffdba5e23810f20885b4390f724553d32efb8b::coin_xaum::COIN_XAUM";
const GR_TYPE = "0x5504354cf3dcbaf64201989bc734e97c1d89bba5c7f01ff2704c43192cc2717c::coin_gr::COIN_GR";
const GY_TYPE = "0x0ac2d5ebd2834c0db725eedcc562c60fa8e281b1772493a4d199fd1e70065671::coin_gy::COIN_GY";
const SUI_TYPE = "0x2::sui::SUI";
const MARKET_OBJECT = "0x166dd68901d2cb47b55c7cfbb7182316f84114f9e12da9251fd4c4f338e37f5d";
const USDC_VAULT_OBJECT = "0x1fc1b07f7c1d06d4d8f0b1d0a2977418ad71df0d531c476273a2143dfeffba0e";
const STAKING_MANAGER_OBJECT = "0x5c9d26e8310f740353eac0e67c351f71bad8748cf5ac90305ffd32a5f3326990";
const CLOCK_OBJECT = "0x0000000000000000000000000000000000000000000000000000000000000006";
const PACKAGE_ID = "0x8cee41afab63e559bc236338bfd7c6b2af07c9f28f285fc8246666a7ce9ae97a";
const FAUCET_PACKAGE_ID = "0xa03cb0b29e92c6fa9bfb7b9c57ffdba5e23810f20885b4390f724553d32efb8b";
const BORROW_MODULE_NAME = "borrow";
const WITHDRAW_MODULE_NAME = "withdraw_collateral";
const X_ORACLE_OBJECT = "0x9052b77605c1e2796582e996e0ce60e2780c9a440d8878a319fa37c50ca32530";
const RISK_MODEL_OBJECT = "0x3a865c5bc0e47efc505781598396d75b647e4f1218359e89b08682519c3ac060";
const OBLIGATION_KEY_TYPE = `${PACKAGE_ID}::obligation::ObligationKey`;
const RULE_PACKAGE_ID = "0xbd6d8bb7f40ca9921d0c61404cba6dcfa132f184cf8c0f273008a103889eb0e8";
const ORACLE_PACKAGE_ID = "0xca9b2f66c5ab734939e048d0732e2a09f486402bb009d88f95c27abe8a4872ee";
const GR_PRICE = BigInt(150500000000);
const SUI_PRICE = BigInt(3180000000);
const USDC_PRICE = BigInt(1000000000);
const GUSD_PRICE = BigInt(1050000000);
const OBLIGATION_REGISTRY_OBJECT = "0x13f4679d0ebd6fc721875af14ee380f45cde02f81d690809ac543901d66f6758";
const SWAP_MODULE_NAME = "gusd_usdc_vault";
const STAKING_MODULE_NAME = "staking_manager";
const DEPOSIT_MODULE_NAME = "deposit_collateral";
const REPAY_MODULE_NAME = "repay";
const DECIMALS = 9;
const SUI_DECIMALS = 9;
const CONFIG_FILE = "config.json";
const isDebug = false;

const XAUM_GLOBAL_MINT_CAP = "0x66984752afbd878aaee450c70142747bb31fca2bb63f0a083d75c361da39adb1";
const USDC_TREASURY = "0x77153159c4e3933658293a46187c30ef68a8f98aa48b0ce76ffb0e6d20c0776b";
const XAUM_FAUCET_AMOUNT = BigInt(1 * 10**DECIMALS);
const USDC_FAUCET_AMOUNT = BigInt(10 * 10**DECIMALS);
const XAUM_MINT_MODULE = "coin_xaum";
const USDC_MINT_MODULE = "usdc";

const HEALTH_FACTOR_CONFIG = {
  PRICE: {
    GR: 150.5,
    SUI: 3.18,
    USDC: 1.0,
    GUSD: 1.05,
  },
};

const swapDirections = [
  { from: "USDC", to: "GUSD", coinTypeIn: USDC_TYPE, coinTypeOut: GUSD_TYPE, function: "mint_gusd" },
  { from: "GUSD", to: "USDC", coinTypeIn: GUSD_TYPE, coinTypeOut: USDC_TYPE, function: "redeem_gusd" }
];

let shouldStop = false;
let accounts = [];
let proxies = [];
let activeProcesses = 0;

let dailyActivityConfig = {
  borrowRepetitions: 3,
  gusdBorrowRange: { min: 1, max: 2 },
  withdrawRepetitions: 12,
  grWithdrawRange: { min: 0.1, max: 0.2 },
  suiWithdrawRange: { min: 0.01, max: 0.02 },
  swapRepetitions: 3,
  stakeRepetitions: 3,
  unstakeRepetitions: 3,
  depositRepetitions: 3,
  repayRepetitions: 3,
  usdcSwapRange: { min: 1, max: 2 },
  gusdSwapRange: { min: 1, max: 2 },
  xaumStakeRange: { min: 0.01, max: 0.02 },
  xaumUnstakeRange: { min: 0.01, max: 0.02 },
  grDepositRange: { min: 0.1, max: 0.2 },
  suiDepositRange: { min: 0.01, max: 0.02 },
  gusdRepayRange: { min: 0.5, max: 1 },
  loopHours: 24
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf8");
      const config = JSON.parse(data);
      dailyActivityConfig.swapRepetitions = Number(config.swapRepetitions) || 3;
      dailyActivityConfig.stakeRepetitions = Number(config.stakeRepetitions) || 3;
      dailyActivityConfig.unstakeRepetitions = Number(config.unstakeRepetitions) || 3;
      dailyActivityConfig.depositRepetitions = Number(config.depositRepetitions) || 3;
      dailyActivityConfig.repayRepetitions = Number(config.repayRepetitions) || 3;
      dailyActivityConfig.usdcSwapRange.min = Number(config.usdcSwapRange?.min) || 1;
      dailyActivityConfig.usdcSwapRange.max = Number(config.usdcSwapRange?.max) || 2;
      dailyActivityConfig.gusdSwapRange.min = Number(config.gusdSwapRange?.min) || 1;
      dailyActivityConfig.gusdSwapRange.max = Number(config.gusdSwapRange?.max) || 2;
      dailyActivityConfig.xaumStakeRange.min = Number(config.xaumStakeRange?.min) || 0.01;
      dailyActivityConfig.xaumStakeRange.max = Number(config.xaumStakeRange?.max) || 0.02;
      dailyActivityConfig.xaumUnstakeRange.min = Number(config.xaumUnstakeRange?.min) || 0.01;
      dailyActivityConfig.xaumUnstakeRange.max = Number(config.xaumUnstakeRange?.max) || 0.02;
      dailyActivityConfig.grDepositRange.min = Number(config.grDepositRange?.min) || 0.1;
      dailyActivityConfig.grDepositRange.max = Number(config.grDepositRange?.max) || 0.2;
      dailyActivityConfig.suiDepositRange.min = Number(config.suiDepositRange?.min) || 0.01;
      dailyActivityConfig.suiDepositRange.max = Number(config.suiDepositRange?.max) || 0.02;
      dailyActivityConfig.gusdRepayRange.min = Number(config.gusdRepayRange?.min) || 0.5;
      dailyActivityConfig.gusdRepayRange.max = Number(config.gusdRepayRange?.max) || 1;
      dailyActivityConfig.withdrawRepetitions = Number(config.withdrawRepetitions) || 12;
      dailyActivityConfig.grWithdrawRange.min = Number(config.grWithdrawRange?.min) || 0.1;
      dailyActivityConfig.grWithdrawRange.max = Number(config.grWithdrawRange?.max) || 0.2;
      dailyActivityConfig.suiWithdrawRange.min = Number(config.suiWithdrawRange?.min) || 0.01;
      dailyActivityConfig.suiWithdrawRange.max = Number(config.suiWithdrawRange?.max) || 0.02;
      dailyActivityConfig.borrowRepetitions = Number(config.borrowRepetitions) || 3;
      dailyActivityConfig.gusdBorrowRange.min = Number(config.gusdBorrowRange?.min) || 1;
      dailyActivityConfig.gusdBorrowRange.max = Number(config.gusdBorrowRange?.max) || 2;
      dailyActivityConfig.loopHours = Number(config.loopHours) || 24;
      console.log(chalk.green("✓ Config loaded successfully"));
    } else {
      console.log(chalk.yellow("⚠ No config file found, using default settings"));
    }
  } catch (error) {
    console.log(chalk.red(`✗ Failed to load config: ${error.message}`));
  }
}

function getShortAddress(address) {
  return address ? address.slice(0, 6) + "..." + address.slice(-4) : "N/A";
}

function addLog(message, type = "info") {
  if (type === "debug" && !isDebug) return;
  let coloredMessage;
  switch (type) {
    case "error":
      coloredMessage = chalk.redBright(message);
      break;
    case "success":
      coloredMessage = chalk.greenBright(message);
      break;
    case "warn":
      coloredMessage = chalk.magentaBright(message);
      break;
    case "wait":
      coloredMessage = chalk.yellowBright(message);
      break;
    case "info":
      coloredMessage = chalk.whiteBright(message);
      break;
    case "delay":
      coloredMessage = chalk.cyanBright(message);
      break;
    case "debug":
      coloredMessage = chalk.blueBright(message);
      break;
    default:
      coloredMessage = chalk.white(message);
  }
  console.log(coloredMessage);
}

function getShortHash(hash) {
  return hash.slice(0, 6) + "..." + hash.slice(-4);
}

function loadAccounts() {
  try {
    const data = fs.readFileSync("pk.txt", "utf8");
    accounts = data.split("\n").map(line => line.trim()).filter(line => line).map(privateKey => ({ privateKey }));
    if (accounts.length === 0) {
      throw new Error("No private keys found in pk.txt");
    }
    addLog(`Loaded ${accounts.length} accounts from pk.txt`, "success");
  } catch (error) {
    addLog(`Failed to load accounts: ${error.message}`, "error");
    accounts = [];
  }
}

function loadProxies() {
  try {
    if (fs.existsSync("proxy.txt")) {
      const data = fs.readFileSync("proxy.txt", "utf8");
      proxies = data.split("\n").map(line => line.trim()); // Jaga agar baris kosong tetap ada
      addLog(`Loaded ${proxies.length} proxies from proxy.txt`, "success");
    } else {
      addLog("No proxy.txt found, running without proxy.", "info");
      proxies = [];
    }
  } catch (error) {
    addLog(`Failed to load proxy: ${error.message}`, "info");
    proxies = [];
  }
}

function createAgent(proxyUrl) {
  if (!proxyUrl) return null;
  if (proxyUrl.startsWith("socks")) {
    return new SocksProxyAgent(proxyUrl);
  } else {
    return new HttpsProxyAgent(proxyUrl);
  }
}

function getClient(proxyUrl) {
  const transport = {
    async request(rpcRequest) {
      const fullRequest = {
        jsonrpc: "2.0",
        id: Math.floor(Math.random() * 100000),
        method: rpcRequest.method,
        params: rpcRequest.params,
      };
      const agent = createAgent(proxyUrl);
      const config = agent ? { httpsAgent: agent } : {};
      const response = await axios.post(CREEK_RPC_URL, fullRequest, config);
      return response.data && response.data.result ? response.data.result : response.data;
    },
  };
  return new SuiClient({ url: CREEK_RPC_URL, transport });
}

async function sleep(ms) {
  if (shouldStop) {
    addLog("Process stopped successfully.", "info");
    return;
  }
  activeProcesses++;
  try {
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, ms);
      const checkStop = setInterval(() => {
        if (shouldStop) {
          clearTimeout(timeout);
          clearInterval(checkStop);
          addLog("Process interrupted.", "info");
          resolve();
        }
      }, 100);
    });
  } catch (error) {
    addLog(`Sleep error: ${error.message}`, "error");
  } finally {
    activeProcesses = Math.max(0, activeProcesses - 1);
  }
}

function formatBalance(totalBalance, decimals) {
  try {
    if (totalBalance == null) return '0.0000';
    const bigBalance = BigInt(totalBalance.toString());
    const divisor = BigInt(10) ** BigInt(decimals);
    const integer = bigBalance / divisor;
    const fraction = ((bigBalance % divisor) * (BigInt(10) ** BigInt(4))) / divisor;
    const formattedFraction = fraction.toString().padStart(4, '0');
    return `${integer.toString()}.${formattedFraction}`;
  } catch (err) {
    addLog(`formatBalance error: ${err.message}`, "debug");
    return '0.0000';
  }
}

async function calculateHealthFactorFromObligation(client, obligationId) {
  try {
    const obligationObject = await client.getObject({
      id: obligationId,
      options: { showContent: true, showType: true }
    });
    if (!obligationObject.data?.content?.fields) {
      addLog(`⚠️ Cannot retrieve obligation data`, "warn");
      return { healthFactor: 0, totalCollateral: 0, totalBorrowed: 0 };
    }
    const fields = obligationObject.data.content.fields;
    let totalCollateralValue = 0;
    let totalBorrowedValue = 0;
    let grDeposited = 0, suiDeposited = 0, usdcDeposited = 0;
    let gusdBorrowed = 0;
    const balanceBagId = fields.balances?.fields?.bag?.fields?.id?.id;
    if (balanceBagId) {
      const dynamicFields = await client.getDynamicFields({ parentId: balanceBagId, limit: 100 });
      const fieldMap = {};
      for (const field of dynamicFields.data) {
        const coinTypeName = field.name?.value?.name || '';
        fieldMap[coinTypeName] = field;
      }
      if (fields.collaterals?.fields?.keys?.fields?.contents) {
        const collateralKeys = fields.collaterals.fields.keys.fields.contents;
        for (const keyObj of collateralKeys) {
          const coinTypeName = keyObj.fields?.name || '';
          try {
            const field = fieldMap[coinTypeName];
            if (!field) continue;
            const fieldData = await client.getObject({ id: field.objectId, options: { showContent: true } });
            let amount = 0;
            const balanceContent = fieldData.data?.content?.fields;
            if (balanceContent?.value) amount = parseInt(balanceContent.value) / Math.pow(10, DECIMALS);
            if (coinTypeName.includes('coin_gr')) {
              grDeposited += amount;
              totalCollateralValue += amount * HEALTH_FACTOR_CONFIG.PRICE.GR;
            } else if (coinTypeName.includes('::sui::SUI')) {
              suiDeposited += amount;
              totalCollateralValue += amount * HEALTH_FACTOR_CONFIG.PRICE.SUI;
            } else if (coinTypeName.includes('usdc')) {
              usdcDeposited += amount;
              totalCollateralValue += amount * HEALTH_FACTOR_CONFIG.PRICE.USDC;
            }
          } catch (e) {}
        }
      }
    }
    const debtTableId = fields.debts?.fields?.table?.fields?.id?.id;
    if (debtTableId && fields.debts?.fields?.keys?.fields?.contents) {
      const debtKeys = fields.debts.fields.keys.fields.contents;
      for (const keyObj of debtKeys) {
        const coinTypeName = keyObj.fields?.name || '';
        try {
          const debtDynamicFields = await client.getDynamicFields({ parentId: debtTableId, limit: 100 });
          let debtField = null;
          for (const field of debtDynamicFields.data) {
            const fieldName = field.name?.value?.name || '';
            if (fieldName === coinTypeName) { debtField = field; break; }
          }
          if (!debtField) continue;
          const debtData = await client.getObject({ id: debtField.objectId, options: { showContent: true } });
          let amount = 0;
          const debtContent = debtData.data?.content?.fields;
          if (debtContent?.value) {
            const debtStruct = debtContent.value;
            if (typeof debtStruct === 'object' && debtStruct !== null) {
              if (debtStruct.fields?.amount) amount = parseInt(debtStruct.fields.amount) / Math.pow(10, DECIMALS);
              else if (debtStruct.amount) amount = parseInt(debtStruct.amount) / Math.pow(10, DECIMALS);
              else if (debtStruct.value) amount = parseInt(debtStruct.value) / Math.pow(10, DECIMALS);
            }
          }
          if (!isNaN(amount) && amount > 0) {
            if (coinTypeName.includes('coin_gusd')) {
              gusdBorrowed += amount;
              totalBorrowedValue += amount * HEALTH_FACTOR_CONFIG.PRICE.GUSD;
            }
          }
        } catch (e) {}
      }
    }
    const healthFactor = totalBorrowedValue > 0 ? totalCollateralValue / totalBorrowedValue : Infinity;
    addLog(`\n╔═══════════════════════════════════════════════════════════╗`, "info");
    addLog(`║           HEALTH FACTOR (Synced with My Position)        ║`, "info");
    addLog(`╚═══════════════════════════════════════════════════════════╝`, "info");
    addLog(`\n📊 DEPOSITS (Collateral):`, "info");
    if (grDeposited > 0 || suiDeposited > 0 || usdcDeposited > 0) {
      if (grDeposited > 0) addLog(`   GR: ${grDeposited.toFixed(4)} @ $${HEALTH_FACTOR_CONFIG.PRICE.GR} = $${(grDeposited * HEALTH_FACTOR_CONFIG.PRICE.GR).toFixed(2)}`, "info");
      if (suiDeposited > 0) addLog(`   SUI: ${suiDeposited.toFixed(6)} @ $${HEALTH_FACTOR_CONFIG.PRICE.SUI} = $${(suiDeposited * HEALTH_FACTOR_CONFIG.PRICE.SUI).toFixed(2)}`, "info");
      if (usdcDeposited > 0) addLog(`   USDC: ${usdcDeposited.toFixed(4)} @ $${HEALTH_FACTOR_CONFIG.PRICE.USDC} = $${(usdcDeposited * HEALTH_FACTOR_CONFIG.PRICE.USDC).toFixed(2)}`, "info");
    } else {
      addLog(`   No Deposits Yet`, "info");
    }
    addLog(`   💰 Total Collateral Value: $${totalCollateralValue.toFixed(2)}`, "info");
    addLog(`\n💸 BORROWED:`, "info");
    if (gusdBorrowed > 0) {
      addLog(`   GUSD: ${gusdBorrowed.toFixed(4)} @ $${HEALTH_FACTOR_CONFIG.PRICE.GUSD} = $${totalBorrowedValue.toFixed(2)}`, "info");
    } else {
      addLog(`   No Borrows Yet`, "info");
    }
    addLog(`   💵 Total Borrowed Value: $${totalBorrowedValue.toFixed(2)}`, "info");
    let status = '';
    if (healthFactor === Infinity) status = '✅ No Borrow - Perfectly Safe';
    else if (healthFactor >= 10) status = '✅ VERY SAFE';
    else if (healthFactor >= 2.0) status = '✅ SAFE';
    else if (healthFactor >= 1.5) status = '⚠️ WARNING';
    else status = '🚨 CRITICAL - RISK OF LIQUIDATION!';
    addLog(`\n${status}`, "warn");
    addLog(`Health Factor: ${healthFactor === Infinity ? '∞' : healthFactor.toFixed(2)}\n`, "info");
    return {
      healthFactor,
      totalCollateral: totalCollateralValue,
      totalBorrowed: totalBorrowedValue,
      deposits: { gr: grDeposited, sui: suiDeposited, usdc: usdcDeposited },
      borrows: { gusd: gusdBorrowed }
    };
  } catch (error) {
    addLog(`❌ Error calculating health factor: ${error.message}`, "error");
    return { healthFactor: 0, totalCollateral: 0, totalBorrowed: 0, deposits: {}, borrows: {} };
  }
}

async function performSwap(keypair, direction, amount, proxyUrl) {
  const client = getClient(proxyUrl);
  const address = keypair.toSuiAddress();
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) throw new Error("Invalid amount");
  const amountIn = BigInt(Math.round(amountNum * Math.pow(10, DECIMALS)));
  const coinsResp = await client.getCoins({ owner: address, coinType: direction.coinTypeIn });
  const coins = Array.isArray(coinsResp?.data) ? coinsResp.data : [];
  if (coins.length === 0) throw new Error(`No ${direction.from} coins found`);
  const coinIds = coins.map(c => c.coinObjectId);
  const [primaryId, ...otherIds] = coinIds;
  const chosen = coinIds.find(id => {
    const c = coins.find(x => x.coinObjectId === id);
    const bal = c?.balance ?? c?.totalBalance ?? null;
    return bal != null && BigInt(bal) >= amountIn;
  }) ?? primaryId;
  const tx = new TransactionBlock();
  if (otherIds.length > 0) {
    const othersToMerge = coinIds.filter(id => id !== chosen);
    if (othersToMerge.length > 0) tx.mergeCoins(tx.object(chosen), othersToMerge.map(id => tx.object(id)));
  }
  const splitResult = tx.splitCoins(tx.object(chosen), [tx.pure(amountIn, 'u64')]);
  const target = `${PACKAGE_ID}::${SWAP_MODULE_NAME}::${direction.function}`;
  if (direction.from === "USDC") {
    tx.moveCall({
      target,
      arguments: [ tx.object(USDC_VAULT_OBJECT), tx.object(MARKET_OBJECT), splitResult, tx.object(CLOCK_OBJECT) ]
    });
  } else {
    tx.moveCall({
      target,
      arguments: [ tx.object(USDC_VAULT_OBJECT), tx.object(MARKET_OBJECT), splitResult ]
    });
  }
  if (typeof isDebug !== "undefined" && isDebug) {
    try {
      const inspect = await client.devInspectTransactionBlock({ transactionBlock: tx, sender: address });
      addLog(`DevInspect: ${JSON.stringify(inspect)}`, "debug");
    } catch (e) {
      addLog(`DevInspect error: ${e.message}`, "debug");
    }
  }
  let sendResult;
  try {
    sendResult = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: { showEffects: true }
    });
    addLog(`Swap Transaction sent: ${getShortHash(sendResult.digest)}`, "warn");
  } catch (err) {
    addLog(`signAndExecute error: ${err.message}`, "error");
    if (err.response) addLog(`RPC error detail: ${JSON.stringify(err.response.data)}`, "debug");
    throw err;
  }
  if (sendResult?.effects) {
    addLog(`Result.effects (local): ${JSON.stringify(sendResult.effects)}`, "debug");
    const status = sendResult.effects?.status?.status ?? sendResult.effects?.status;
    if (status === "success" || status === "ok") {
      addLog(`Swap Successfully!, Hash: ${getShortHash(sendResult.digest)}`, "success");
      return sendResult;
    } else {
      addLog(`Transaction failed according to local effects: ${JSON.stringify(sendResult.effects?.status)}`, "error");
      throw new Error("Transaction failed according to local effects");
    }
  }
  const digest = sendResult.digest;
  const maxAttempts = 10;
  const delayMs = 1000;
  let receipt = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      try {
        receipt = await client.waitForTransactionBlock({ digest, timeout: 5000 });
      } catch (e) {
        receipt = await client.getTransactionBlock({ digest, options: { showEffects: true, showEvents: true } });
      }
      if (receipt) break;
    } catch (err) {
      addLog(`Debug: polling attempt ${i+1}/${maxAttempts} failed: ${err?.message ?? err}`, "debug");
      if (err && typeof err === 'object' && err.code && err.code !== -32602) {
        addLog(`RPC returned non-404 error: ${JSON.stringify(err)}`, "debug");
      }
      await sleep(delayMs);
    }
  }
  if (!receipt) {
    addLog(`Could not fetch transaction receipt after ${maxAttempts} attempts. Digest: ${digest}`, "error");
    throw new Error("No receipt found after polling");
  }
  addLog(`Receipt effects: ${JSON.stringify(receipt.effects ?? receipt)}`, "debug");
  const status = (receipt.effects?.status?.status) ?? (receipt.effects?.status ?? null);
  if (status !== "success") {
    const errMsg = receipt.effects?.status?.error ?? 'unknown error';
    addLog(`Transaction effects indicate failure. Status: ${status}, Error: ${errMsg}`, "error");
    addLog(`Full receipt: ${JSON.stringify(receipt)}`, "debug");
    throw new Error(`Transaction failed: ${errMsg}`);
  }
  addLog(`Swap ${amount} ${direction.from} ➯ ${direction.to} Successfully, Hash: ${getShortHash(digest)}`, "success");
  return receipt;
}

async function performStake(keypair, amount, proxyUrl) {
  const client = getClient(proxyUrl);
  const address = keypair.toSuiAddress();
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) throw new Error("Invalid stake amount");
  const amountIn = BigInt(Math.round(amountNum * Math.pow(10, DECIMALS)));
  const xaumBalance = await client.getBalance({ owner: address, coinType: XAUM_TYPE });
  const formattedXAUM = formatBalance(xaumBalance.totalBalance, DECIMALS);
  addLog(`Current XAUM Balance: ${formattedXAUM} XAUM`, "info");
  const coinsResp = await client.getCoins({ owner: address, coinType: XAUM_TYPE });
  const coins = Array.isArray(coinsResp?.data) ? coinsResp.data : [];
  if (coins.length === 0) throw new Error("No XAUM coins found");
  const coinIds = coins.map(c => c.coinObjectId);
  const [primaryId, ...otherIds] = coinIds;
  const chosen = coinIds.find(id => {
    const c = coins.find(x => x.coinObjectId === id);
    const bal = c?.balance ?? c?.totalBalance ?? null;
    return bal != null && BigInt(bal) >= amountIn;
  }) ?? primaryId;
  const tx = new TransactionBlock();
  if (otherIds.length > 0) {
    const othersToMerge = coinIds.filter(id => id !== chosen);
    if (othersToMerge.length > 0) tx.mergeCoins(tx.object(chosen), othersToMerge.map(id => tx.object(id)));
  }
  const splitResult = tx.splitCoins(tx.object(chosen), [tx.pure(amountIn, 'u64')]);
  tx.moveCall({
    target: `${PACKAGE_ID}::${STAKING_MODULE_NAME}::stake_xaum`,
    arguments: [tx.object(STAKING_MANAGER_OBJECT), splitResult]
  });
  if (isDebug) {
    try {
      const inspect = await client.devInspectTransactionBlock({ transactionBlock: tx, sender: address });
      addLog(`DevInspect for stake: ${JSON.stringify(inspect)}`, "debug");
    } catch (e) {
      addLog(`DevInspect error for stake: ${e.message}`, "debug");
    }
  }
  let sendResult;
  try {
    sendResult = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: { showEffects: true }
    });
    addLog(`Stake Transaction sent: ${getShortHash(sendResult.digest)}`, "warn");
  } catch (err) {
    addLog(`signAndExecute error for stake: ${err.message}`, "error");
    if (err.response) addLog(`RPC error detail for stake: ${JSON.stringify(err.response.data)}`, "debug");
    throw err;
  }
  if (sendResult?.effects) {
    addLog(`Result.effects (local) for stake: ${JSON.stringify(sendResult.effects)}`, "debug");
    const status = sendResult.effects?.status?.status ?? sendResult.effects?.status;
    if (status === "success" || status === "ok") {
      addLog(`Stake Successfully , Hash: ${getShortHash(sendResult.digest)}`, "success");
      return sendResult;
    } else {
      addLog(`Stake failed according to local effects: ${JSON.stringify(sendResult.effects?.status)}`, "error");
      throw new Error("Stake failed according to local effects");
    }
  }
  const digest = sendResult.digest;
  const maxAttempts = 10;
  const delayMs = 1000;
  let receipt = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      try {
        receipt = await client.waitForTransactionBlock({ digest, timeout: 5000 });
      } catch (e) {
        receipt = await client.getTransactionBlock({ digest, options: { showEffects: true, showEvents: true } });
      }
      if (receipt) break;
    } catch (err) {
      addLog(`Debug: polling attempt ${i+1}/${maxAttempts} failed for stake: ${err?.message ?? err}`, "debug");
      if (err && typeof err === 'object' && err.code && err.code !== -32602) {
        addLog(`RPC returned non-404 error for stake: ${JSON.stringify(err)}`, "debug");
      }
      await sleep(delayMs);
    }
  }
  if (!receipt) {
    addLog(`Could not fetch stake transaction receipt after ${maxAttempts} attempts. Digest: ${digest}`, "error");
    throw new Error("No receipt found after polling for stake");
  }
  addLog(`Receipt effects for stake: ${JSON.stringify(receipt.effects ?? receipt)}`, "debug");
  const status = (receipt.effects?.status?.status) ?? (receipt.effects?.status ?? null);
  if (receipt.effects?.status?.error) {
    const errMsg = receipt.effects.status.error;
    addLog(`Stake effects indicate failure. Status: ${status}, Error: ${errMsg}`, "error");
    addLog(`Full receipt for stake: ${JSON.stringify(receipt)}`, "debug");
    throw new Error(`Stake failed: ${errMsg}`);
  }
  addLog(`Stake ${amount} XAUM Successfully, Hash ${getShortHash(digest)}`, "success");
  return receipt;
}

async function performUnstake(keypair, amount, proxyUrl) {
  const client = getClient(proxyUrl);
  const address = keypair.toSuiAddress();
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) throw new Error("Invalid unstake amount");
  const grGyAmountIn = BigInt(Math.round(amountNum * 100 * Math.pow(10, DECIMALS)));
  const grBalance = await client.getBalance({ owner: address, coinType: GR_TYPE });
  const gyBalance = await client.getBalance({ owner: address, coinType: GY_TYPE });
  const formattedGR = parseFloat(formatBalance(grBalance.totalBalance, DECIMALS));
  const formattedGY = parseFloat(formatBalance(gyBalance.totalBalance, DECIMALS));
  const maxUnstake = Math.min(formattedGR / 100, formattedGY / 100);
  addLog(`Max XAUM that can be unstaked: ${maxUnstake.toFixed(4)} XAUM`, "info");
  if (amountNum > maxUnstake) {
    throw new Error(`Insufficient GR/GY for unstaking ${amount} XAUM. Max: ${maxUnstake.toFixed(4)} XAUM`);
  }
  const grCoinsResp = await client.getCoins({ owner: address, coinType: GR_TYPE });
  const grCoins = Array.isArray(grCoinsResp?.data) ? grCoinsResp.data : [];
  if (grCoins.length === 0) throw new Error("No GR coins found");
  const grCoinIds = grCoins.map(c => c.coinObjectId);
  const [grPrimaryId, ...grOtherIds] = grCoinIds;
  const grChosen = grCoinIds.find(id => {
    const c = grCoins.find(x => x.coinObjectId === id);
    const bal = c?.balance ?? c?.totalBalance ?? null;
    return bal != null && BigInt(bal) >= grGyAmountIn;
  }) ?? grPrimaryId;
  const gyCoinsResp = await client.getCoins({ owner: address, coinType: GY_TYPE });
  const gyCoins = Array.isArray(gyCoinsResp?.data) ? gyCoinsResp.data : [];
  if (gyCoins.length === 0) throw new Error("No GY coins found");
  const gyCoinIds = gyCoins.map(c => c.coinObjectId);
  const [gyPrimaryId, ...gyOtherIds] = gyCoinIds;
  const gyChosen = gyCoinIds.find(id => {
    const c = gyCoins.find(x => x.coinObjectId === id);
    const bal = c?.balance ?? c?.totalBalance ?? null;
    return bal != null && BigInt(bal) >= grGyAmountIn;
  }) ?? gyPrimaryId;
  const tx = new TransactionBlock();
  if (grOtherIds.length > 0) {
    const grOthersToMerge = grCoinIds.filter(id => id !== grChosen);
    if (grOthersToMerge.length > 0) tx.mergeCoins(tx.object(grChosen), grOthersToMerge.map(id => tx.object(id)));
  }
  const grSplitResult = tx.splitCoins(tx.object(grChosen), [tx.pure(grGyAmountIn, 'u64')]);
  if (gyOtherIds.length > 0) {
    const gyOthersToMerge = gyCoinIds.filter(id => id !== gyChosen);
    if (gyOthersToMerge.length > 0) tx.mergeCoins(tx.object(gyChosen), gyOthersToMerge.map(id => tx.object(id)));
  }
  const gySplitResult = tx.splitCoins(tx.object(gyChosen), [tx.pure(grGyAmountIn, 'u64')]);
  tx.moveCall({
    target: `${PACKAGE_ID}::${STAKING_MODULE_NAME}::unstake`,
    arguments: [tx.object(STAKING_MANAGER_OBJECT), grSplitResult, gySplitResult]
  });
  if (isDebug) {
    try {
      const inspect = await client.devInspectTransactionBlock({ transactionBlock: tx, sender: address });
      addLog(`DevInspect for unstake: ${JSON.stringify(inspect)}`, "debug");
    } catch (e) {
      addLog(`DevInspect error for unstake: ${e.message}`, "debug");
    }
  }
  let sendResult;
  try {
    sendResult = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: { showEffects: true }
    });
    addLog(`Unstake Transaction sent: ${getShortHash(sendResult.digest)}`, "warn");
  } catch (err) {
    addLog(`signAndExecute error for unstake: ${err.message}`, "error");
    if (err.response) addLog(`RPC error detail for unstake: ${JSON.stringify(err.response.data)}`, "debug");
    throw err;
  }
  if (sendResult?.effects) {
    addLog(`Result.effects (local) for unstake: ${JSON.stringify(sendResult.effects)}`, "debug");
    const status = sendResult.effects?.status?.status ?? sendResult.effects?.status;
    if (status === "success" || status === "ok") {
      addLog(`Unstake Successfully , Hash: ${getShortHash(sendResult.digest)}`, "success");
      return sendResult;
    } else {
      addLog(`Unstake failed according to local effects: ${JSON.stringify(sendResult.effects?.status)}`, "error");
      throw new Error("Unstake failed according to local effects");
    }
  }
  const digest = sendResult.digest;
  const maxAttempts = 10;
  const delayMs = 1000;
  let receipt = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      try {
        receipt = await client.waitForTransactionBlock({ digest, timeout: 5000 });
      } catch (e) {
        receipt = await client.getTransactionBlock({ digest, options: { showEffects: true, showEvents: true } });
      }
      if (receipt) break;
    } catch (err) {
      addLog(`Debug: polling attempt ${i+1}/${maxAttempts} failed for unstake: ${err?.message ?? err}`, "debug");
      if (err && typeof err === 'object' && err.code && err.code !== -32602) {
        addLog(`RPC returned non-404 error for unstake: ${JSON.stringify(err)}`, "debug");
      }
      await sleep(delayMs);
    }
  }
  if (!receipt) {
    addLog(`Could not fetch unstake transaction receipt after ${maxAttempts} attempts. Digest: ${digest}`, "error");
    throw new Error("No receipt found after polling for unstake");
  }
  addLog(`Receipt effects for unstake: ${JSON.stringify(receipt.effects ?? receipt)}`, "debug");
  const status = (receipt.effects?.status?.status) ?? (receipt.effects?.status ?? null);
  if (receipt.effects?.status?.error) {
    const errMsg = receipt.effects.status.error;
    addLog(`Unstake effects indicate failure. Status: ${status}, Error: ${errMsg}`, "error");
    addLog(`Full receipt for unstake: ${JSON.stringify(receipt)}`, "debug");
    throw new Error(`Unstake failed: ${errMsg}`);
  }
  addLog(`Unstake ${amount} XAUM Successfully, Hash ${getShortHash(digest)}`, "success");
  return receipt;
}

async function performDeposit(keypair, amount, proxyUrl, coinType, typeArg, coinName) {
  const client = getClient(proxyUrl);
  const address = keypair.toSuiAddress();
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) throw new Error("Invalid deposit amount");
  const amountIn = BigInt(Math.round(amountNum * Math.pow(10, DECIMALS)));
  const balance = await client.getBalance({ owner: address, coinType });
  const formattedBalance = formatBalance(balance.totalBalance, DECIMALS);
  addLog(`Current ${coinName} Balance: ${formattedBalance} ${coinName}`, "info");
  const { obligationId } = await getObligationDetails(client, address, keypair, proxyUrl);
  const tx = new TransactionBlock();
  let splitResult;
  if (coinType === SUI_TYPE) {
    const coinsResp = await client.getCoins({ owner: address, coinType: SUI_TYPE });
    const coins = Array.isArray(coinsResp?.data) ? coinsResp.data : [];
    if (coins.length === 0) throw new Error("No SUI coins found");
    const otherIds = coins.map(c => c.coinObjectId).filter(id => id !== coins[0].coinObjectId);
    if (otherIds.length > 0) {
      tx.mergeCoins(tx.gas, otherIds.map(id => tx.object(id)));
    }
    splitResult = tx.splitCoins(tx.gas, [tx.pure(amountIn, 'u64')]);
  } else {
    const coinsResp = await client.getCoins({ owner: address, coinType });
    const coins = Array.isArray(coinsResp?.data) ? coinsResp.data : [];
    if (coins.length === 0) throw new Error(`No ${coinName} coins found`);
    const coinIds = coins.map(c => c.coinObjectId);
    const [primaryId, ...otherIds] = coinIds;
    const chosen = coinIds.find(id => {
      const c = coins.find(x => x.coinObjectId === id);
      const bal = c?.balance ?? c?.totalBalance ?? null;
      return bal != null && BigInt(bal) >= amountIn;
    }) ?? primaryId;
    if (otherIds.length > 0) {
      const othersToMerge = coinIds.filter(id => id !== chosen);
      if (othersToMerge.length > 0) tx.mergeCoins(tx.object(chosen), othersToMerge.map(id => tx.object(id)));
    }
    splitResult = tx.splitCoins(tx.object(chosen), [tx.pure(amountIn, 'u64')]);
  }
  tx.moveCall({
    target: `${PACKAGE_ID}::${DEPOSIT_MODULE_NAME}::deposit_collateral`,
    arguments: [tx.object(OBLIGATION_REGISTRY_OBJECT), tx.object(obligationId), tx.object(MARKET_OBJECT), splitResult],
    typeArguments: [typeArg]
  });
  if (isDebug) {
    try {
      const inspect = await client.devInspectTransactionBlock({ transactionBlock: tx, sender: address });
      addLog(`DevInspect for deposit: ${JSON.stringify(inspect)}`, "debug");
    } catch (e) {
      addLog(`DevInspect error for deposit: ${e.message}`, "debug");
    }
  }
  let sendResult;
  try {
    sendResult = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: { showEffects: true }
    });
    addLog(`Deposit Transaction sent: ${getShortHash(sendResult.digest)}`, "warn");
  } catch (err) {
    addLog(`signAndExecute error for deposit: ${err.message}`, "error");
    if (err.response) addLog(`RPC error detail for deposit: ${JSON.stringify(err.response.data)}`, "debug");
    throw err;
  }
  if (sendResult?.effects) {
    addLog(`Result.effects (local) for deposit: ${JSON.stringify(sendResult.effects)}`, "debug");
    const status = sendResult.effects?.status?.status ?? sendResult.effects?.status;
    if (status === "success" || status === "ok") {
      addLog(`Deposit Successfully, Hash: ${getShortHash(sendResult.digest)}`, "success");
      return sendResult;
    } else {
      addLog(`Deposit failed according to local effects: ${JSON.stringify(sendResult.effects?.status)}`, "error");
      throw new Error("Deposit failed according to local effects");
    }
  }
  const digest = sendResult.digest;
  const maxAttempts = 10;
  const delayMs = 1000;
  let receipt = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      try {
        receipt = await client.waitForTransactionBlock({ digest, timeout: 5000 });
      } catch (e) {
        receipt = await client.getTransactionBlock({ digest, options: { showEffects: true, showEvents: true } });
      }
      if (receipt) break;
    } catch (err) {
      addLog(`Debug: polling attempt ${i+1}/${maxAttempts} failed for deposit: ${err?.message ?? err}`, "debug");
      if (err && typeof err === 'object' && err.code && err.code !== -32602) {
        addLog(`RPC returned non-404 error for deposit: ${JSON.stringify(err)}`, "debug");
      }
      await sleep(delayMs);
    }
  }
  if (!receipt) {
    addLog(`Could not fetch deposit transaction receipt after ${maxAttempts} attempts. Digest: ${digest}`, "error");
    throw new Error("No receipt found after polling for deposit");
  }
  addLog(`Receipt effects for deposit: ${JSON.stringify(receipt.effects ?? receipt)}`, "debug");
  const status = (receipt.effects?.status?.status) ?? (receipt.effects?.status ?? null);
  if (receipt.effects?.status?.error) {
    const errMsg = receipt.effects.status.error;
    addLog(`Deposit effects indicate failure. Status: ${status}, Error: ${errMsg}`, "error");
    addLog(`Full receipt for deposit: ${JSON.stringify(receipt)}`, "debug");
    throw new Error(`Deposit failed: ${errMsg}`);
  }
  addLog(`Deposit ${amount} ${coinName} Successfully, Hash ${getShortHash(digest)}`, "success");
  return receipt;
}

async function performWithdraw(keypair, amount, proxyUrl, coinType, typeArg, coinName) {
  const client = getClient(proxyUrl);
  const address = keypair.toSuiAddress();
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) throw new Error("Invalid withdraw amount");
  const amountIn = BigInt(Math.round(amountNum * Math.pow(10, DECIMALS)));

  // Ambil detail obligation dan key
  const {
    obligationKeyId,
    obligationKeyVersion,
    obligationKeyDigest,
    obligationId,
  } = await getObligationDetails(client, address, keypair, proxyUrl);

  // Membuat harga unik untuk tiap update agar state oracle selalu berubah
  const uniqueSuffix = BigInt(Date.now() % 1000000);

  const uniqueGrPrice    = GR_PRICE + uniqueSuffix;
  const uniqueSuiPrice   = SUI_PRICE + uniqueSuffix;
  const uniqueUsdcPrice  = USDC_PRICE + uniqueSuffix;

  const tx = new TransactionBlock();

  // Update harga GR
  const grUpdateReq = tx.moveCall({
    target: `${ORACLE_PACKAGE_ID}::x_oracle::price_update_request`,
    arguments: [tx.object(X_ORACLE_OBJECT)],
    typeArguments: [GR_TYPE],
  });
  tx.moveCall({
    target: `${RULE_PACKAGE_ID}::rule::set_price_as_primary`,
    arguments: [grUpdateReq, tx.pure(uniqueGrPrice, 'u64'), tx.object(CLOCK_OBJECT)],
    typeArguments: [GR_TYPE],
  });
  tx.moveCall({
    target: `${ORACLE_PACKAGE_ID}::x_oracle::confirm_price_update_request`,
    arguments: [tx.object(X_ORACLE_OBJECT), grUpdateReq, tx.object(CLOCK_OBJECT)],
    typeArguments: [GR_TYPE],
  });

  // Update harga SUI
  const suiUpdateReq = tx.moveCall({
    target: `${ORACLE_PACKAGE_ID}::x_oracle::price_update_request`,
    arguments: [tx.object(X_ORACLE_OBJECT)],
    typeArguments: [SUI_TYPE],
  });
  tx.moveCall({
    target: `${RULE_PACKAGE_ID}::rule::set_price_as_primary`,
    arguments: [suiUpdateReq, tx.pure(uniqueSuiPrice, 'u64'), tx.object(CLOCK_OBJECT)],
    typeArguments: [SUI_TYPE],
  });
  tx.moveCall({
    target: `${ORACLE_PACKAGE_ID}::x_oracle::confirm_price_update_request`,
    arguments: [tx.object(X_ORACLE_OBJECT), suiUpdateReq, tx.object(CLOCK_OBJECT)],
    typeArguments: [SUI_TYPE],
  });

  // Update harga USDC
  const usdcUpdateReq = tx.moveCall({
    target: `${ORACLE_PACKAGE_ID}::x_oracle::price_update_request`,
    arguments: [tx.object(X_ORACLE_OBJECT)],
    typeArguments: [USDC_TYPE],
  });
  tx.moveCall({
    target: `${RULE_PACKAGE_ID}::rule::set_price_as_primary`,
    arguments: [usdcUpdateReq, tx.pure(uniqueUsdcPrice, 'u64'), tx.object(CLOCK_OBJECT)],
    typeArguments: [USDC_TYPE],
  });
  tx.moveCall({
    target: `${ORACLE_PACKAGE_ID}::x_oracle::confirm_price_update_request`,
    arguments: [tx.object(X_ORACLE_OBJECT), usdcUpdateReq, tx.object(CLOCK_OBJECT)],
    typeArguments: [USDC_TYPE],
  });

  // Withdraw collateral entry
  tx.moveCall({
    target: `${PACKAGE_ID}::${WITHDRAW_MODULE_NAME}::withdraw_collateral_entry`,
    arguments: [
      tx.object(OBLIGATION_REGISTRY_OBJECT),
      tx.object(obligationId),
      tx.objectRef({
        objectId: obligationKeyId,
        version: obligationKeyVersion,
        digest: obligationKeyDigest,
      }),
      tx.object(MARKET_OBJECT),
      tx.object(RISK_MODEL_OBJECT),
      tx.pure(amountIn, 'u64'),
      tx.object(X_ORACLE_OBJECT),
      tx.object(CLOCK_OBJECT),
    ],
    typeArguments: [typeArg],
  });

  // Eksekusi transaksi dan polling status
  let sendResult;
  try {
    sendResult = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: { showEffects: true },
    });
    addLog(`Withdraw Transaction sent: ${getShortHash(sendResult.digest)}`, "warn");
  } catch (err) {
    addLog(`signAndExecute error for withdraw: ${err.message}`, "error");
    if (err.response)
      addLog(`RPC error detail for withdraw: ${JSON.stringify(err.response.data)}`, "debug");
    throw err;
  }

  if (sendResult?.effects) {
    addLog(`Result.effects (local) for withdraw: ${JSON.stringify(sendResult.effects)}`, "debug");
    const status = sendResult.effects?.status?.status ?? sendResult.effects?.status;
    if (status === "success" || status === "ok") {
      addLog(`Withdraw success, Hash: ${getShortHash(sendResult.digest)}`, "success");
      return sendResult;
    } else {
      addLog(`Withdraw failed according to local effects: ${JSON.stringify(sendResult.effects?.status)}`, "error");
      throw new Error("Withdraw failed according to local effects");
    }
  }

  // Polling receipt
  const digest = sendResult.digest;
  const maxAttempts = 10;
  const delayMs = 1000;
  let receipt = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      try {
        receipt = await client.waitForTransactionBlock({ digest, timeout: 5000 });
      } catch (e) {
        receipt = await client.getTransactionBlock({ digest, options: { showEffects: true, showEvents: true } });
      }
      if (receipt) break;
    } catch (err) {
      addLog(`Debug: polling attempt ${i + 1}/${maxAttempts} failed for withdraw: ${err?.message ?? err}`, "debug");
      await sleep(delayMs);
    }
  }
  if (!receipt) {
    addLog(`Could not fetch withdraw transaction receipt after ${maxAttempts} attempts. Digest: ${digest}`, "error");
    throw new Error("No receipt found after polling for withdraw");
  }
  addLog(`Withdraw ${amount} ${coinName} Successfully, Hash ${getShortHash(digest)}`, "success");
  return receipt;
}

async function getObligationDetails(client, address, keypair, proxyUrl) {
  let objects = await client.getOwnedObjects({
    owner: address,
    filter: { StructType: OBLIGATION_KEY_TYPE },
    options: { showContent: true, showType: true, showPreviousTransaction: true }
  });
  let obligationKeyData = objects.data || [];
  if (obligationKeyData.length === 0) {
    addLog(`No ObligationKey found for address ${address}. Creating new obligation.`, "info");
    const tx = new TransactionBlock();
    tx.moveCall({
      target: `${PACKAGE_ID}::obligation_registry::create_obligation`,
      arguments: [tx.object(OBLIGATION_REGISTRY_OBJECT)]
    });
    let sendResult;
    try {
      sendResult = await client.signAndExecuteTransactionBlock({
        signer: keypair,
        transactionBlock: tx,
        options: { showEffects: true }
      });
      addLog(`Create obligation transaction sent: ${getShortHash(sendResult.digest)}`, "warn");
    } catch (err) {
      addLog(`signAndExecute error for create obligation: ${err.message}`, "error");
      throw err;
    }
    await sleep(5000);
    objects = await client.getOwnedObjects({
      owner: address,
      filter: { StructType: OBLIGATION_KEY_TYPE },
      options: { showContent: true, showType: true, showPreviousTransaction: true }
    });
    obligationKeyData = objects.data || [];
    if (obligationKeyData.length === 0) throw new Error("Failed to create ObligationKey");
  }
  const keyObject = obligationKeyData[0].data;
  const obligationKeyId = keyObject.objectId;
  const obligationKeyVersion = keyObject.version;
  const obligationKeyDigest = keyObject.digest;
  const fields = keyObject.content.fields;
  const obligationId = fields.ownership.fields.of;
  return { obligationKeyId, obligationKeyVersion, obligationKeyDigest, obligationId };
}

async function performBorrow(keypair, amount, proxyUrl) {
  const client = getClient(proxyUrl);
  const address = keypair.toSuiAddress();
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) throw new Error("Invalid borrow amount");
  const amountIn = BigInt(Math.round(amountNum * Math.pow(10, DECIMALS)));
  const { obligationKeyId, obligationKeyVersion, obligationKeyDigest, obligationId } = await getObligationDetails(client, address, keypair, proxyUrl);
  const tx = new TransactionBlock();
  
  // 1. GR Price Update
  const grUpdateReq = tx.moveCall({
    target: `${ORACLE_PACKAGE_ID}::x_oracle::price_update_request`,
    arguments: [tx.object(X_ORACLE_OBJECT)],
    typeArguments: [GR_TYPE]
  });
  tx.moveCall({
    target: `${RULE_PACKAGE_ID}::rule::set_price_as_primary`,
    arguments: [grUpdateReq, tx.pure(GR_PRICE, 'u64'), tx.object(CLOCK_OBJECT)],
    typeArguments: [GR_TYPE]
  });
  tx.moveCall({
    target: `${ORACLE_PACKAGE_ID}::x_oracle::confirm_price_update_request`,
    arguments: [tx.object(X_ORACLE_OBJECT), grUpdateReq, tx.object(CLOCK_OBJECT)],
    typeArguments: [GR_TYPE]
  });
  
  // 2. USDC Price Update (FIXED - Added missing USDC update)
  const usdcUpdateReq = tx.moveCall({
    target: `${ORACLE_PACKAGE_ID}::x_oracle::price_update_request`,
    arguments: [tx.object(X_ORACLE_OBJECT)],
    typeArguments: [USDC_TYPE]
  });
  tx.moveCall({
    target: `${RULE_PACKAGE_ID}::rule::set_price_as_primary`,
    arguments: [usdcUpdateReq, tx.pure(BigInt(1e9), 'u64'), tx.object(CLOCK_OBJECT)],
    typeArguments: [USDC_TYPE]
  });
  tx.moveCall({
    target: `${ORACLE_PACKAGE_ID}::x_oracle::confirm_price_update_request`,
    arguments: [tx.object(X_ORACLE_OBJECT), usdcUpdateReq, tx.object(CLOCK_OBJECT)],
    typeArguments: [USDC_TYPE]
  });
  
  // 3. SUI Price Update
  const suiUpdateReq = tx.moveCall({
    target: `${ORACLE_PACKAGE_ID}::x_oracle::price_update_request`,
    arguments: [tx.object(X_ORACLE_OBJECT)],
    typeArguments: [SUI_TYPE]
  });
  tx.moveCall({
    target: `${RULE_PACKAGE_ID}::rule::set_price_as_primary`,
    arguments: [suiUpdateReq, tx.pure(SUI_PRICE, 'u64'), tx.object(CLOCK_OBJECT)],
    typeArguments: [SUI_TYPE]
  });
  tx.moveCall({
    target: `${ORACLE_PACKAGE_ID}::x_oracle::confirm_price_update_request`,
    arguments: [tx.object(X_ORACLE_OBJECT), suiUpdateReq, tx.object(CLOCK_OBJECT)],
    typeArguments: [SUI_TYPE]
  });
  
  // 4. GUSD Price Update
  const gusdUpdateReq = tx.moveCall({
    target: `${ORACLE_PACKAGE_ID}::x_oracle::price_update_request`,
    arguments: [tx.object(X_ORACLE_OBJECT)],
    typeArguments: [GUSD_TYPE]
  });
  tx.moveCall({
    target: `${RULE_PACKAGE_ID}::rule::set_price_as_primary`,
    arguments: [gusdUpdateReq, tx.pure(GUSD_PRICE, 'u64'), tx.object(CLOCK_OBJECT)],
    typeArguments: [GUSD_TYPE]
  });
  tx.moveCall({
    target: `${ORACLE_PACKAGE_ID}::x_oracle::confirm_price_update_request`,
    arguments: [tx.object(X_ORACLE_OBJECT), gusdUpdateReq, tx.object(CLOCK_OBJECT)],
    typeArguments: [GUSD_TYPE]
  });
  
  // 5. Borrow Entry
  tx.moveCall({
    target: `${PACKAGE_ID}::${BORROW_MODULE_NAME}::borrow_entry`,
    arguments: [
      tx.object(OBLIGATION_REGISTRY_OBJECT),
      tx.object(obligationId),
      tx.objectRef({ objectId: obligationKeyId, version: obligationKeyVersion, digest: obligationKeyDigest }),
      tx.object(MARKET_OBJECT),
      tx.object(RISK_MODEL_OBJECT),
      tx.pure(amountIn, 'u64'),
      tx.object(X_ORACLE_OBJECT),
      tx.object(CLOCK_OBJECT)
    ]
  });
  if (isDebug) {
    try {
      const inspect = await client.devInspectTransactionBlock({ transactionBlock: tx, sender: address });
      addLog(`DevInspect for borrow: ${JSON.stringify(inspect)}`, "debug");
    } catch (e) {
      addLog(`DevInspect error for borrow: ${e.message}`, "debug");
    }
  }
  let sendResult;
  try {
    sendResult = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: { showEffects: true }
    });
    addLog(`Borrow Transaction sent: ${getShortHash(sendResult.digest)}`, "warn");
  } catch (err) {
    addLog(`signAndExecute error for borrow: ${err.message}`, "error");
    if (err.response) addLog(`RPC error detail for borrow: ${JSON.stringify(err.response.data)}`, "debug");
    throw err;
  }
  if (sendResult?.effects) {
    addLog(`Result.effects (local) for borrow: ${JSON.stringify(sendResult.effects)}`, "debug");
    const status = sendResult.effects?.status?.status ?? sendResult.effects?.status;
    if (status === "success" || status === "ok") {
      addLog(`Borrow Successfully , Hash: ${getShortHash(sendResult.digest)}`, "success");
      return sendResult;
    } else {
      addLog(`Borrow failed according to local effects: ${JSON.stringify(sendResult.effects?.status)}`, "error");
      throw new Error("Borrow failed according to local effects");
    }
  }
  const digest = sendResult.digest;
  const maxAttempts = 10;
  const delayMs = 1000;
  let receipt = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      try {
        receipt = await client.waitForTransactionBlock({ digest, timeout: 5000 });
      } catch (e) {
        receipt = await client.getTransactionBlock({ digest, options: { showEffects: true, showEvents: true } });
      }
      if (receipt) break;
    } catch (err) {
      addLog(`Debug: polling attempt ${i+1}/${maxAttempts} failed for borrow: ${err?.message ?? err}`, "debug");
      if (err && typeof err === 'object' && err.code && err.code !== -32602) {
        addLog(`RPC returned non-404 error for borrow: ${JSON.stringify(err)}`, "debug");
      }
      await sleep(delayMs);
    }
  }
  if (!receipt) {
    addLog(`Could not fetch borrow transaction receipt after ${maxAttempts} attempts. Digest: ${digest}`, "error");
    throw new Error("No receipt found after polling for borrow");
  }
  addLog(`Receipt effects for borrow: ${JSON.stringify(receipt.effects ?? receipt)}`, "debug");
  const status = (receipt.effects?.status?.status) ?? (receipt.effects?.status ?? null);
  if (receipt.effects?.status?.error) {
    const errMsg = receipt.effects.status.error;
    addLog(`Borrow effects indicate failure. Status: ${status}, Error: ${errMsg}`, "error");
    addLog(`Full receipt for borrow: ${JSON.stringify(receipt)}`, "debug");
    throw new Error(`Borrow failed: ${errMsg}`);
  }
  addLog(`Borrow ${amount} GUSD Successfully, Hash ${getShortHash(digest)}`, "success");
  return receipt;
}

async function performRepay(keypair, amount, proxyUrl) {
  const client = getClient(proxyUrl);
  const address = keypair.toSuiAddress();
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) throw new Error("Invalid repay amount");
  const amountIn = BigInt(Math.round(amountNum * Math.pow(10, DECIMALS)));
  const gusdBalance = await client.getBalance({ owner: address, coinType: GUSD_TYPE });
  const formattedGUSD = formatBalance(gusdBalance.totalBalance, DECIMALS);
  addLog(`Current GUSD Balance: ${formattedGUSD} GUSD`, "info");
  const { obligationId } = await getObligationDetails(client, address, keypair, proxyUrl);
  const gusdCoinsResp = await client.getCoins({ owner: address, coinType: GUSD_TYPE });
  const gusdCoins = Array.isArray(gusdCoinsResp?.data) ? gusdCoinsResp.data : [];
  if (gusdCoins.length === 0) throw new Error("No GUSD coins found");
  const gusdCoinIds = gusdCoins.map(c => c.coinObjectId);
  const [gusdPrimaryId, ...gusdOtherIds] = gusdCoinIds;
  const gusdChosen = gusdCoinIds.find(id => {
    const c = gusdCoins.find(x => x.coinObjectId === id);
    const bal = c?.balance ?? c?.totalBalance ?? null;
    return bal != null && BigInt(bal) >= amountIn;
  }) ?? gusdPrimaryId;
  const tx = new TransactionBlock();
  if (gusdOtherIds.length > 0) {
    const gusdOthersToMerge = gusdCoinIds.filter(id => id !== gusdChosen);
    if (gusdOthersToMerge.length > 0) tx.mergeCoins(tx.object(gusdChosen), gusdOthersToMerge.map(id => tx.object(id)));
  }
  const gusdSplitResult = tx.splitCoins(tx.object(gusdChosen), [tx.pure(amountIn)]);
  tx.moveCall({
    target: `${PACKAGE_ID}::${REPAY_MODULE_NAME}::repay`,
    arguments: [
      tx.object(OBLIGATION_REGISTRY_OBJECT),
      tx.object(obligationId),
      tx.object(MARKET_OBJECT),
      gusdSplitResult,
      tx.object(CLOCK_OBJECT)
    ],
    typeArguments: [GUSD_TYPE]
  });
  if (isDebug) {
    try {
      const inspect = await client.devInspectTransactionBlock({ transactionBlock: tx, sender: address });
      addLog(`DevInspect for repay: ${JSON.stringify(inspect)}`, "debug");
    } catch (e) {
      addLog(`DevInspect error for repay: ${e.message}`, "debug");
    }
  }
  let sendResult;
  try {
    sendResult = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: { showEffects: true }
    });
    addLog(`Repay Transaction sent: ${getShortHash(sendResult.digest)}`, "warn");
  } catch (err) {
    addLog(`signAndExecute error for repay: ${err.message}`, "error");
    if (err.response) addLog(`RPC error detail for repay: ${JSON.stringify(err.response.data)}`, "debug");
    throw err;
  }
  if (sendResult?.effects) {
    addLog(`Result.effects (local) for repay: ${JSON.stringify(sendResult.effects)}`, "debug");
    const status = sendResult.effects?.status?.status ?? sendResult.effects?.status;
    if (status === "success" || status === "ok") {
      addLog(`Repay Successfully , Hash: ${getShortHash(sendResult.digest)}`, "success");
      return sendResult;
    } else {
      addLog(`Repay failed according to local effects: ${JSON.stringify(sendResult.effects?.status)}`, "error");
      throw new Error("Repay failed according to local effects");
    }
  }
  const digest = sendResult.digest;
  const maxAttempts = 10;
  const delayMs = 1000;
  let receipt = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      try {
        receipt = await client.waitForTransactionBlock({ digest, timeout: 5000 });
      } catch (e) {
        receipt = await client.getTransactionBlock({ digest, options: { showEffects: true, showEvents: true } });
      }
      if (receipt) break;
    } catch (err) {
      addLog(`Debug: polling attempt ${i+1}/${maxAttempts} failed for repay: ${err?.message ?? err}`, "debug");
      if (err && typeof err === 'object' && err.code && err.code !== -32602) {
        addLog(`RPC returned non-404 error for repay: ${JSON.stringify(err)}`, "debug");
      }
      await sleep(delayMs);
    }
  }
  if (!receipt) {
    addLog(`Could not fetch repay transaction receipt after ${maxAttempts} attempts. Digest: ${digest}`, "error");
    throw new Error("No receipt found after polling for repay");
  }
  addLog(`Receipt effects for repay: ${JSON.stringify(receipt.effects ?? receipt)}`, "debug");
  const status = (receipt.effects?.status?.status) ?? (receipt.effects?.status ?? null);
  if (status !== "success") {
    const errMsg = receipt.effects?.status?.error ?? null;
    addLog(`Repay effects indicate failure. Error: ${errMsg}`, "error");
    addLog(`Full receipt for repay: ${JSON.stringify(receipt)}`, "debug");
    throw new Error(`Repay failed: ${errMsg ?? "no error message in effects"}`);
  }
  addLog(`Repay ${amount} GUSD Successfully, Hash ${getShortHash(digest)}`, "success");
  return receipt;
}

async function performMintXAUM(keypair, proxyUrl) {
  const client = getClient(proxyUrl);
  const address = keypair.toSuiAddress();
  const tx = new TransactionBlock();
  tx.moveCall({
    target: `${FAUCET_PACKAGE_ID}::${XAUM_MINT_MODULE}::mint`,
    arguments: [
      tx.object(XAUM_GLOBAL_MINT_CAP),
      tx.pure(XAUM_FAUCET_AMOUNT, 'u64'),
      tx.pure(address, 'address')
    ]
  });
  if (isDebug) {
    try {
      const inspect = await client.devInspectTransactionBlock({ transactionBlock: tx, sender: address });
      addLog(`DevInspect for XAUM mint: ${JSON.stringify(inspect)}`, "debug");
    } catch (e) {
      addLog(`DevInspect error for XAUM mint: ${e.message}`, "debug");
    }
  }
  let sendResult;
  try {
    sendResult = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: { showEffects: true }
    });
    addLog(`XAUM Mint Transaction sent: ${getShortHash(sendResult.digest)}`, "warn");
  } catch (err) {
    addLog(`signAndExecute error for XAUM mint: ${err.message}`, "error");
    if (err.response) addLog(`RPC error detail for XAUM mint: ${JSON.stringify(err.response.data)}`, "debug");
    throw err;
  }
  const digest = sendResult.digest;
  const maxAttempts = 10;
  const delayMs = 1000;
  let receipt = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      try {
        receipt = await client.waitForTransactionBlock({ digest, timeout: 5000 });
      } catch (e) {
        receipt = await client.getTransactionBlock({ digest, options: { showEffects: true, showEvents: true } });
      }
      if (receipt) break;
    } catch (err) {
      addLog(`Debug: polling attempt ${i+1}/${maxAttempts} failed for XAUM mint: ${err?.message ?? err}`, "debug");
      if (err && typeof err === 'object' && err.code && err.code !== -32602) {
        addLog(`RPC returned non-404 error for XAUM mint: ${JSON.stringify(err)}`, "debug");
      }
      await sleep(delayMs);
    }
  }
  if (!receipt) {
    addLog(`Could not fetch XAUM mint transaction receipt after ${maxAttempts} attempts. Digest: ${digest}`, "error");
    throw new Error("No receipt found after polling for XAUM mint");
  }
  addLog(`Receipt for XAUM mint: ${JSON.stringify(receipt)}`, "debug");
  if (receipt.effects?.status?.error) {
    const errMsg = receipt.effects.status.error;
    addLog(`XAUM mint failed. Error: ${errMsg}`, "error");
    addLog(`Full receipt for XAUM mint: ${JSON.stringify(receipt)}`, "debug");
    throw new Error(`XAUM mint failed: ${errMsg}`);
  }
  addLog(`Successfully minted 1 XAUM, Hash: ${getShortHash(digest)}`, "success");
  return receipt;
}

async function performMintUSDC(keypair, proxyUrl) {
  const client = getClient(proxyUrl);
  const address = keypair.toSuiAddress();
  const tx = new TransactionBlock();
  tx.moveCall({
    target: `${FAUCET_PACKAGE_ID}::${USDC_MINT_MODULE}::mint`,
    arguments: [
      tx.object(USDC_TREASURY),
      tx.pure(USDC_FAUCET_AMOUNT, 'u64'),
      tx.pure(address, 'address')
    ]
  });
  if (isDebug) {
    try {
      const inspect = await client.devInspectTransactionBlock({ transactionBlock: tx, sender: address });
      addLog(`DevInspect for USDC mint: ${JSON.stringify(inspect)}`, "debug");
    } catch (e) {
      addLog(`DevInspect error for USDC mint: ${e.message}`, "debug");
    }
  }
  let sendResult;
  try {
    sendResult = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: { showEffects: true }
    });
    addLog(`USDC Mint Transaction sent: ${getShortHash(sendResult.digest)}`, "warn");
  } catch (err) {
    addLog(`signAndExecute error for USDC mint: ${err.message}`, "error");
    if (err.response) addLog(`RPC error detail for USDC mint: ${JSON.stringify(err.response.data)}`, "debug");
    throw err;
  }
  const digest = sendResult.digest;
  const maxAttempts = 10;
  const delayMs = 1000;
  let receipt = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      try {
        receipt = await client.waitForTransactionBlock({ digest, timeout: 5000 });
      } catch (e) {
        receipt = await client.getTransactionBlock({ digest, options: { showEffects: true, showEvents: true } });
      }
      if (receipt) break;
    } catch (err) {
      addLog(`Debug: polling attempt ${i+1}/${maxAttempts} failed for USDC mint: ${err?.message ?? err}`, "debug");
      if (err && typeof err === 'object' && err.code && err.code !== -32602) {
        addLog(`RPC returned non-404 error for USDC mint: ${JSON.stringify(err)}`, "debug");
      }
      await sleep(delayMs);
    }
  }
  if (!receipt) {
    addLog(`Could not fetch USDC mint transaction receipt after ${maxAttempts} attempts. Digest: ${digest}`, "error");
    throw new Error("No receipt found after polling for USDC mint");
  }
  addLog(`Receipt for USDC mint: ${JSON.stringify(receipt)}`, "debug");
  if (receipt.effects?.status?.error) {
    const errMsg = receipt.effects.status.error;
    addLog(`USDC mint failed. Error: ${errMsg}`, "error");
    addLog(`Full receipt for USDC mint: ${JSON.stringify(receipt)}`, "debug");
    throw new Error(`USDC mint failed: ${errMsg}`);
  }
  addLog(`Successfully minted 10 USDC, Hash: ${getShortHash(digest)}`, "success");
  return receipt;
}

async function runDailyActivity() {
  addLog("Starting daily activity for all accounts.", "info");
  try {
    for (let i = 0; i < accounts.length && !shouldStop; i++) {
      const account = accounts[i];
      const proxyUrl = proxies[i] && proxies[i].length > 0 ? proxies[i] : null;
      const client = getClient(proxyUrl);
      const { secretKey } = decodeSuiPrivateKey(account.privateKey);
      const keypair = Ed25519Keypair.fromSecretKey(secretKey);
      const address = keypair.toSuiAddress();
      const isLocalConnection = !proxyUrl;
                addLog(`Processing Account ${i + 1}: 
${getShortAddress(address)}${isLocalConnection ? " (using local IP)" : ""}`, "wait");

      // Auto claim faucet XAUM
      addLog(`Account ${i + 1} - Claiming XAUM faucet...`, "warn");
      try {
        await performMintXAUM(keypair, proxyUrl);
      } catch (error) {
        addLog(`Account ${i + 1} - XAUM faucet claim failed: ${error.message}. Skipping.`, "error");
      } finally {
        await sleep(3000);
      }

      // Auto claim faucet USDC
      addLog(`Account ${i + 1} - Claiming USDC faucet...`, "warn");
      try {
        await performMintUSDC(keypair, proxyUrl);
      } catch (error) {
        addLog(`Account ${i + 1} - USDC faucet claim failed: ${error.message}. Skipping.`, "error");
      } finally {
        await sleep(3000);
      }

      if (!shouldStop) {
        addLog(`Account ${i + 1} - Waiting 10 seconds before starting swaps...`, "delay");
        await sleep(10000);
      }

      // Swaps
      let directionIndex = 0;
      for (let swapCount = 0; swapCount < dailyActivityConfig.swapRepetitions && !shouldStop; swapCount++) {
        const currentDirection = swapDirections[directionIndex % swapDirections.length];
        let amount;
        if (currentDirection.from === "USDC") {
          amount = (Math.random() * (dailyActivityConfig.usdcSwapRange.max - dailyActivityConfig.usdcSwapRange.min) + dailyActivityConfig.usdcSwapRange.min).toFixed(3);
        } else if (currentDirection.from === "GUSD") {
          amount = (Math.random() * (dailyActivityConfig.gusdSwapRange.max - dailyActivityConfig.gusdSwapRange.min) + dailyActivityConfig.gusdSwapRange.min).toFixed(3);
        }
        addLog(`Account ${i + 1} - Swap ${swapCount + 1}: ${amount} ${currentDirection.from} ➯ ${currentDirection.to}`, "warn");
        try {
          await performSwap(keypair, currentDirection, amount, proxyUrl);
        } catch (error) {
          addLog(`Account ${i + 1} - Swap ${swapCount + 1} (${currentDirection.from} ➯ ${currentDirection.to}): Failed: ${error.message}. Skipping.`, "error");
        } finally {
          await sleep(3000);
        }
        directionIndex++;
        if (swapCount < dailyActivityConfig.swapRepetitions - 1 && !shouldStop) {
          const randomDelay = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
          addLog(`Account ${i + 1} - Waiting ${Math.floor(randomDelay / 1000)} seconds before next swap...`, "delay");
          await sleep(randomDelay);
        }
      }

      if (!shouldStop) {
        addLog(`Account ${i + 1} - Waiting 10 seconds before starting staking...`, "delay");
        await sleep(10000);
      }

      // Staking
      for (let stakeCount = 0; stakeCount < dailyActivityConfig.stakeRepetitions && !shouldStop; stakeCount++) {
        const stakeAmount = (Math.random() * (dailyActivityConfig.xaumStakeRange.max - dailyActivityConfig.xaumStakeRange.min) + dailyActivityConfig.xaumStakeRange.min).toFixed(4);
        addLog(`Account ${i + 1} - Stake ${stakeCount + 1}: ${stakeAmount} XAUM`, "warn");
        try {
          await performStake(keypair, stakeAmount, proxyUrl);
        } catch (error) {
          addLog(`Account ${i + 1} - Stake ${stakeCount + 1}: Failed: ${error.message}. Skipping.`, "error");
        } finally {
          await sleep(3000);
        }
        if (stakeCount < dailyActivityConfig.stakeRepetitions - 1 && !shouldStop) {
          const randomDelay = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
          addLog(`Account ${i + 1} - Waiting ${Math.floor(randomDelay / 1000)} seconds before next stake...`, "delay");
          await sleep(randomDelay);
        }
      }

      if (!shouldStop) {
        addLog(`Account ${i + 1} - Waiting 10 seconds before starting unstaking...`, "delay");
        await sleep(10000);
      }

      // Unstaking
      for (let unstakeCount = 0; unstakeCount < dailyActivityConfig.unstakeRepetitions && !shouldStop; unstakeCount++) {
        const unstakeAmount = (Math.random() * (dailyActivityConfig.xaumUnstakeRange.max - dailyActivityConfig.xaumUnstakeRange.min) + dailyActivityConfig.xaumUnstakeRange.min).toFixed(4);
        addLog(`Account ${i + 1} - Unstake ${unstakeCount + 1}: ${unstakeAmount} XAUM`, "warn");
        try {
          await performUnstake(keypair, unstakeAmount, proxyUrl);
        } catch (error) {
          addLog(`Account ${i + 1} - Unstake ${unstakeCount + 1}: Failed: ${error.message}. Skipping.`, "error");
        } finally {
          await sleep(3000);
        }
        if (unstakeCount < dailyActivityConfig.unstakeRepetitions - 1 && !shouldStop) {
          const randomDelay = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
          addLog(`Account ${i + 1} - Waiting ${Math.floor(randomDelay / 1000)} seconds before next unstake...`, "delay");
          await sleep(randomDelay);
        }
      }

      if (!shouldStop) {
        addLog(`Account ${i + 1} - Waiting 10 seconds before starting depositing...`, "delay");
        await sleep(10000);
      }

      // Depositing
      if (dailyActivityConfig.depositRepetitions > 0) {
        const suiBalance = await client.getBalance({ owner: address, coinType: SUI_TYPE });
        const formattedSUI = formatBalance(suiBalance.totalBalance, SUI_DECIMALS);
        for (let depositCount = 0; depositCount < dailyActivityConfig.depositRepetitions && !shouldStop; depositCount++) {
          const isGR = depositCount % 2 === 0;
          const coinType = isGR ? GR_TYPE : SUI_TYPE;
          const typeArg = coinType;
          const coinName = isGR ? "GR" : "SUI";
          const range = isGR ? dailyActivityConfig.grDepositRange : dailyActivityConfig.suiDepositRange;
          const depositAmount = (Math.random() * (range.max - range.min) + range.min).toFixed(4);
          addLog(`Account ${i + 1} - Deposit ${depositCount + 1}: ${depositAmount} ${coinName}`, "warn");
          try {
            await performDeposit(keypair, depositAmount, proxyUrl, coinType, typeArg, coinName);
          } catch (error) {
            addLog(`Account ${i + 1} - Deposit ${depositCount + 1}: Failed: ${error.message}. Skipping.`, "error");
          } finally {
            await sleep(3000);
          }
          if (depositCount < dailyActivityConfig.depositRepetitions - 1 && !shouldStop) {
            const randomDelay = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
            addLog(`Account ${i + 1} - Waiting ${Math.floor(randomDelay / 1000)} seconds before next deposit...`, "delay");
            await sleep(randomDelay);
          }
        }
      }

      if (!shouldStop) {
        addLog(`Account ${i + 1} - Waiting 10 seconds before starting withdrawing...`, "delay");
        await sleep(10000);
      }

      // Withdrawing
      for (let withdrawCount = 0; withdrawCount < dailyActivityConfig.withdrawRepetitions && !shouldStop; withdrawCount++) {
        const isGR = withdrawCount % 2 === 0;
        const coinType = isGR ? GR_TYPE : SUI_TYPE;
        const typeArg = coinType;
        const coinName = isGR ? "GR" : "SUI";
        const range = isGR ? dailyActivityConfig.grWithdrawRange : dailyActivityConfig.suiWithdrawRange;
        const withdrawAmount = (Math.random() * (range.max - range.min) + range.min).toFixed(4);
        addLog(`Account ${i + 1} - Withdraw ${withdrawCount + 1}: ${withdrawAmount} ${coinName}`, "warn");
        try {
          await performWithdraw(keypair, withdrawAmount, proxyUrl, coinType, typeArg, coinName);
        } catch (error) {
          addLog(`Account ${i + 1} - Withdraw ${withdrawCount + 1}: Failed: ${error.message}. Skipping.`, "error");
        } finally {
          await sleep(3000);
        }
        if (withdrawCount < dailyActivityConfig.withdrawRepetitions - 1 && !shouldStop) {
          const randomDelay = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
          addLog(`Account ${i + 1} - Waiting ${Math.floor(randomDelay / 1000)} seconds before next withdraw...`, "delay");
          await sleep(randomDelay);
        }
      }

      if (!shouldStop) {
        addLog(`Account ${i + 1} - Waiting 10 seconds before starting borrowing...`, "delay");
        await sleep(10000);
      }

      // Borrowing
      if (dailyActivityConfig.borrowRepetitions > 0) {
        addLog(`Borrow Process Started `, "info");
        for (let borrowCount = 0; borrowCount < dailyActivityConfig.borrowRepetitions && !shouldStop; borrowCount++) {
          const borrowAmount = (Math.random() * (dailyActivityConfig.gusdBorrowRange.max - dailyActivityConfig.gusdBorrowRange.min) + dailyActivityConfig.gusdBorrowRange.min).toFixed(4);
          addLog(`Account ${i + 1} - Borrow ${borrowCount + 1}: ${borrowAmount} GUSD`, "warn");
          try {
            await performBorrow(keypair, borrowAmount, proxyUrl);
          } catch (error) {
            addLog(`Account ${i + 1} - Borrow ${borrowCount + 1}: Failed: ${error.message}. Skipping.`, "error");
          } finally {
            await sleep(3000);
          }
          if (borrowCount < dailyActivityConfig.borrowRepetitions - 1 && !shouldStop) {
            const randomDelay = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
            addLog(`Account ${i + 1} - Waiting ${Math.floor(randomDelay / 1000)} seconds before next borrow...`, "delay");
            await sleep(randomDelay);
          }
        }
      }

      if (!shouldStop) {
        addLog(`Account ${i + 1} - Waiting 10 seconds before starting repaying...`, "delay");
        await sleep(10000);
      }

      // Repaying
      for (let repayCount = 0; repayCount < dailyActivityConfig.repayRepetitions && !shouldStop; repayCount++) {
        const repayAmount = (Math.random() * (dailyActivityConfig.gusdRepayRange.max - dailyActivityConfig.gusdRepayRange.min) + dailyActivityConfig.gusdRepayRange.min).toFixed(4);
        addLog(`Account ${i + 1} - Repay ${repayCount + 1}: ${repayAmount} GUSD`, "warn");
        try {
          await performRepay(keypair, repayAmount, proxyUrl);
        } catch (error) {
          addLog(`Account ${i + 1} - Repay ${repayCount + 1}: Failed: ${error.message}. Skipping.`, "error");
        } finally {
          await sleep(3000);
        }
        if (repayCount < dailyActivityConfig.repayRepetitions - 1 && !shouldStop) {
          const randomDelay = Math.floor(Math.random() * (25000 - 10000 + 1)) + 10000;
          addLog(`Account ${i + 1} - Waiting ${Math.floor(randomDelay / 1000)} seconds before next repay...`, "delay");
          await sleep(randomDelay);
        }
      }

      // HEALTH FACTOR SUMMARY - Added at the end of each account processing
      try {
        addLog(`\n${'='.repeat(60)}`, "info");
        addLog(`Account ${i + 1} - Fetching Health Factor Summary...`, "wait");
        addLog(`${'='.repeat(60)}`, "info");
        
        const { obligationId } = await getObligationDetails(client, address, keypair, proxyUrl);
        await calculateHealthFactorFromObligation(client, obligationId);
        
        addLog(`${'='.repeat(60)}\n`, "info");
      } catch (error) {
        addLog(`Account ${i + 1} - Failed to fetch health factor: ${error.message}`, "error");
      }

      if (i < accounts.length - 1 && !shouldStop) {
        addLog(`Waiting 10 seconds before next account...`, "delay");
        await sleep(10000);
      }
    }

    if (!shouldStop && activeProcesses <= 0) {
      addLog(`All accounts processed. Waiting ${dailyActivityConfig.loopHours} hours for next cycle.`, "success");
      setTimeout(runDailyActivity, dailyActivityConfig.loopHours * 60 * 60 * 1000);
    }
  } catch (error) {
    addLog(`Daily activity failed: ${error.message}`, "error");
  }
}

async function initialize() {
  try {
    console.log(chalk.cyan.bold("\n╔══════════════════════════════════════════╗"));
    console.log(chalk.cyan.bold("║        CREEK AUTO BOT - by AI            ║"));
    console.log(chalk.cyan.bold("╚══════════════════════════════════════════╝\n"));
    
    loadConfig();
    loadAccounts();
    loadProxies();
    
    addLog("Initialization complete. Starting auto daily activity...", "success");
    await runDailyActivity();
  } catch (error) {
    addLog(`Initialization error: ${error.message}`, "error");
    process.exit(1);
  }
}

process.on("unhandledRejection", (reason) => {
  addLog(`Unhandled Rejection: ${reason.message || reason}`, "error");
});

process.on("uncaughtException", (error) => {
  addLog(`Uncaught Exception: ${error.message}\n${error.stack}`, "error");
  process.exit(1);
});

process.on("SIGINT", () => {
  addLog("\nReceived SIGINT. Gracefully shutting down...", "warn");
  shouldStop = true;
  setTimeout(() => {
    addLog("Bot stopped.", "info");
    process.exit(0);
  }, 2000);
});

initialize();
