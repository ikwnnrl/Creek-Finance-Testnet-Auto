const { Ed25519Keypair } = require('@mysten/sui.js/keypairs/ed25519');
const { TransactionBlock } = require('@mysten/sui.js/transactions');
const { SuiClient } = require('@mysten/sui.js/client');
const { decodeSuiPrivateKey } = require('@mysten/sui.js/cryptography');
const fs = require('fs');

// ============================================
// CONFIG
// ============================================
const CONFIG = {
    RPC_URL: 'https://sui-testnet-rpc.publicnode.com',
    PRIVATE_KEYS_FILE: 'privatekey.txt',
    PROXY_FILE: 'proxy.txt',
    SUI_FAUCET_URL: 'https://faucet.testnet.sui.io/v2/gas',
    SUI_FAUCET_RETRIES: 50,
    MIN_SUI_BALANCE: 1,
    MIST_PER_SUI: 1000000000,
    GAS_BUDGET: '200000000',
    DECIMALS: 1000000000,
    XAUM_CLAIM_COUNT: 3,
    USDC_CLAIM_COUNT: 3,
    SWAP_USDC_TO_GUSD_COUNT: 3,
    SWAP_GUSD_TO_USDC_COUNT: 1,
    STAKE_XAUM_COUNT: 3,
    REDEEM_XAUM_COUNT: 3,
    DEPOSIT_GR_COUNT: 3,
    DEPOSIT_SUI_COUNT: 3,
    DEPOSIT_USDC_COUNT: 3,
    BORROW_GUSD_COUNT: 3,
    REPAY_GUSD_COUNT: 3,
    WITHDRAW_COUNT: 3,
    COIN_FETCH_RETRIES: 5,
    RATE_LIMIT_COOLDOWN: 30,
    FAUCET_PACKAGE: '0xa03cb0b29e92c6fa9bfb7b9c57ffdba5e23810f20885b4390f724553d32efb8b',
    XAUM_SHARED_OBJECT: '0x66984752afbd878aaee450c70142747bb31fca2bb63f0a083d75c361da39adb1',
    USDC_SHARED_OBJECT: '0x77153159c4e3933658293a46187c30ef68a8f98aa48b0ce76ffb0e6d20c0776b',
    GUSD_PACKAGE: '0x8cee41afab63e559bc236338bfd7c6b2af07c9f28f285fc8246666a7ce9ae97a',
    GUSD_VAULT: '0x1fc1b07f7c1d06d4d8f0b1d0a2977418ad71df0d531c476273a2143dfeffba0e',
    GUSD_MARKET: '0x166dd68901d2cb47b55c7cfbb7182316f84114f9e12da9251fd4c4f338e37f5d',
    STAKING_MANAGER: '0x5c9d26e8310f740353eac0e67c351f71bad8748cf5ac90305ffd32a5f3326990',
    CLOCK_OBJECT: '0x0000000000000000000000000000000000000000000000000000000000000006',
    LENDING_PACKAGE: '0x8cee41afab63e559bc236338bfd7c6b2af07c9f28f285fc8246666a7ce9ae97a',
    PROTOCOL_OBJECT: '0x13f4679d0ebd6fc721875af14ee380f45cde02f81d690809ac543901d66f6758',
    LENDING_MARKET: '0x166dd68901d2cb47b55c7cfbb7182316f84114f9e12da9251fd4c4f338e37f5d',
    XORACLE_OBJECT: '0x9052b77605c1e2796582e996e0ce60e2780c9a440d8878a319fa37c50ca32530',
    PRICE_ORACLE: '0x3a865c5bc0e47efc505781598396d75b647e4f1218359e89b08682519c3ac060',
    ORACLE_PACKAGE: '0xca9b2f66c5ab734939e048d0732e2a09f486402bb009d88f95c27abe8a4872ee',
    RULE_PACKAGE: '0xbd6d8bb7f40ca9921d0c61404cba6dcfa132f184cf8c0f273008a103889eb0e8',
    USDC_TYPE: '0xa03cb0b29e92c6fa9bfb7b9c57ffdba5e23810f20885b4390f724553d32efb8b::usdc::USDC',
    GUSD_TYPE: '0x5434351f2dcae30c0c4b97420475c5edc966b02fd7d0bbe19ea2220d2f623586::coin_gusd::COIN_GUSD',
    XAUM_TYPE: '0xa03cb0b29e92c6fa9bfb7b9c57ffdba5e23810f20885b4390f724553d32efb8b::coin_xaum::COIN_XAUM',
    GY_TYPE: '0x0ac2d5ebd2834c0db725eedcc562c60fa8e281b1772493a4d199fd1e70065671::coin_gy::COIN_GY',
    GR_TYPE: '0x5504354cf3dcbaf64201989bc734e97c1d89bba5c7f01ff2704c43192cc2717c::coin_gr::COIN_GR',
    SUI_TYPE: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
};

const HEALTH_FACTOR_CONFIG = {
    DEPOSIT_PERCENTAGE: { GR: 0.70, SUI: 0.50, USDC: 0.80 },
    MIN_RESERVE: { GR: 50 * 1e9, SUI: 1 * 1e9, USDC: 5 * 1e9 },
    PRICE: { GR: 150.5, SUI: 3.18, USDC: 1.0, GUSD: 1.05 }
};

const suiClient = new SuiClient({ url: CONFIG.RPC_URL });

// ============================================
// PROXY MANAGEMENT
// ============================================
function readProxyMappings(filename = CONFIG.PROXY_FILE) {
    try {
        if (!fs.existsSync(filename)) {
            console.log(`⚠️ File ${filename} tidak ditemukan - semua wallet gunakan Local IP\n`);
            return {};
        }
        const proxies = {};
        const lines = fs.readFileSync(filename, 'utf8').split('\n');
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                proxies[`pk${index + 1}`] = trimmed;
            } else {
                proxies[`pk${index + 1}`] = null;
            }
        });
        return proxies;
    } catch (error) {
        console.error(`Gagal membaca ${filename}:`, error.message);
        return {};
    }
}

function getProxyForWallet(walletIndex, proxyMappings) {
    const key = `pk${walletIndex}`;
    const proxy = proxyMappings[key];
    
    if (!proxy) {
        console.log(`  🌍 Local IP`);
        return null;
    }
    
    console.log(`  🔗 Proxy: ${proxy}`);
    return proxy;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function getRandomDelay(minSec, maxSec) {
    return Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
}

async function delay(ms, message = 'Waiting') {
    console.log(`⏳ ${message} ${Math.floor(ms / 1000)}s...`);
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomAmount(min, max, decimals = CONFIG.DECIMALS) {
    return Math.floor((Math.random() * (max - min) + min) * decimals);
}

function readPrivateKeys(filename = CONFIG.PRIVATE_KEYS_FILE) {
    try {
        if (!fs.existsSync(filename)) {
            console.log(`❌ File ${filename} tidak ditemukan!`);
            return [];
        }
        return fs.readFileSync(filename, 'utf8').split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#'));
    } catch (error) {
        console.error(`Gagal membaca ${filename}:`, error.message);
        return [];
    }
}

function importWallet(privateKeyStr) {
    try {
        const secretKey = decodeSuiPrivateKey(privateKeyStr);
        const keypair = Ed25519Keypair.fromSecretKey(secretKey.secretKey);
        const address = keypair.getPublicKey().toSuiAddress();
        return { keypair, address };
    } catch (error) {
        console.error('Error importing wallet:', error.message);
        return null;
    }
}

async function getSuiBalance(address) {
    try {
        const balance = await suiClient.getBalance({ owner: address });
        return parseInt(balance.totalBalance) / CONFIG.MIST_PER_SUI;
    } catch (error) {
        return 0;
    }
}

async function requestSuiFaucet(address) {
    try {
        const response = await fetch(CONFIG.SUI_FAUCET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ FixedAmountRequest: { recipient: address } })
        });
        const responseText = await response.text();
        if (response.status === 429) return { success: false, error: 'Rate limit', isRateLimit: true };
        if (response.status === 200) {
            try {
                const data = JSON.parse(responseText);
                if (data.status?.Failure) return { success: false, error: data.status.Failure.Internal || 'Error' };
                return { success: true, data };
            } catch (e) {
                return { success: false, error: 'Invalid JSON' };
            }
        }
        return { success: false, error: `Status ${response.status}` };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function ensureSuiFaucet(address) {
    console.log(`\n💧 Memastikan wallet memiliki minimal ${CONFIG.MIN_SUI_BALANCE} SUI...`);
    for (let attempt = 1; attempt <= CONFIG.SUI_FAUCET_RETRIES; attempt++) {
        const currentBalance = await getSuiBalance(address);
        console.log(`  📊 Balance: ${currentBalance.toFixed(6)} SUI (${attempt}/${CONFIG.SUI_FAUCET_RETRIES})`);
        if (currentBalance >= CONFIG.MIN_SUI_BALANCE) {
            console.log(`  ✓ Balance mencukupi!`);
            return true;
        }
        console.log(`  💧 Request SUI Faucet...`);
        const result = await requestSuiFaucet(address);
        if (result.success) {
            console.log(`  ✓ Faucet berhasil!`);
            await delay(3000, 'Balance update:');
        } else {
            console.log(`  ✗ Gagal: ${result.error}`);
            if (result.isRateLimit) {
                await delay(getRandomDelay(3, 10), 'Rate limit:');
            } else if (attempt < CONFIG.SUI_FAUCET_RETRIES) {
                await delay(getRandomDelay(3, 10), 'Retry:');
            }
        }
    }
    const finalBalance = await getSuiBalance(address);
    if (finalBalance >= CONFIG.MIN_SUI_BALANCE) {
        console.log(`  ✓ Balance mencukupi!`);
        return true;
    }
    console.log(`  ✗ Gagal setelah ${CONFIG.SUI_FAUCET_RETRIES} attempts`);
    return false;
}

async function getCoins(address, coinType) {
    try {
        const coins = await suiClient.getCoins({ owner: address, coinType: coinType });
        return coins.data;
    } catch (error) {
        if (error.message && (error.message.includes('429') || error.message.includes('status code: 429'))) {
            console.log(`  ⚠️ Rate limited! Waiting ${CONFIG.RATE_LIMIT_COOLDOWN}s...`);
            await delay(CONFIG.RATE_LIMIT_COOLDOWN * 1000, 'Rate limit cooldown:');
            try {
                const coins = await suiClient.getCoins({ owner: address, coinType: coinType });
                return coins.data;
            } catch (retryError) {
                console.error(`  ✗ Still failed: ${retryError.message}`);
                return [];
            }
        }
        console.error(`  ✗ Error getting coins: ${error.message}`);
        return [];
    }
}

async function getCoinsWithRetry(address, coinType, retries = CONFIG.COIN_FETCH_RETRIES) {
    let coins = [];
    for (let i = 0; i < retries; i++) {
        if (i > 0) console.log(`  🔄 Retry ${i}/${retries}...`);
        await delay(getRandomDelay(10, 15), 'Fetching coins:');
        coins = await getCoins(address, coinType);
        if (coins.length > 0) break;
    }
    return coins;
}

function calculateSafeDepositAmount(currentBalance, tokenType) {
    const depositPercentage = HEALTH_FACTOR_CONFIG.DEPOSIT_PERCENTAGE[tokenType] || 0.7;
    const minReserve = HEALTH_FACTOR_CONFIG.MIN_RESERVE[tokenType] || 0;
    const depositByPercentage = currentBalance * depositPercentage;
    const depositWithReserve = currentBalance - minReserve;
    const safeDeposit = Math.min(depositByPercentage, depositWithReserve);
    return Math.max(0, Math.floor(safeDeposit));
}

async function getTokenBalance(address, tokenType) {
    try {
        if (tokenType === CONFIG.SUI_TYPE) {
            return await getSuiBalance(address);
        } else {
            const coins = await getCoins(address, tokenType);
            const total = coins.reduce((sum, coin) => sum + BigInt(coin.balance), BigInt(0));
            return Number(total) / CONFIG.DECIMALS;
        }
    } catch (error) {
        console.error(`Error getting balance for ${tokenType}:`, error.message);
        return 0;
    }
}

async function getWalletBalances(address) {
    try {
        const grBalance = await getTokenBalance(address, CONFIG.GR_TYPE);
        const suiBalance = await getTokenBalance(address, CONFIG.SUI_TYPE);
        const usdcBalance = await getTokenBalance(address, CONFIG.USDC_TYPE);
        const gusdBalance = await getTokenBalance(address, CONFIG.GUSD_TYPE);
        const xaumBalance = await getTokenBalance(address, CONFIG.XAUM_TYPE);
        
        return {
            GR: grBalance,
            SUI: suiBalance,
            USDC: usdcBalance,
            GUSD: gusdBalance,
            XAUM: xaumBalance,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error(`Error getting wallet balances:`, error.message);
        return null;
    }
}

function printBalanceReport(address, balanceBefore, balanceAfter) {
    if (!balanceBefore || !balanceAfter) return;
    
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  💰 BALANCE TRACKING REPORT`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`  Address: ${address.substring(0, 12)}...${address.substring(address.length - 8)}`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`  Token │      Before      │       After      │     Change`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`  GR    │ ${balanceBefore.GR.toFixed(6).padStart(15)} │ ${balanceAfter.GR.toFixed(6).padStart(15)} │ ${(balanceAfter.GR - balanceBefore.GR).toFixed(6).padStart(12)}`);
    console.log(`  SUI   │ ${balanceBefore.SUI.toFixed(6).padStart(15)} │ ${balanceAfter.SUI.toFixed(6).padStart(15)} │ ${(balanceAfter.SUI - balanceBefore.SUI).toFixed(6).padStart(12)}`);
    console.log(`  USDC  │ ${balanceBefore.USDC.toFixed(6).padStart(15)} │ ${balanceAfter.USDC.toFixed(6).padStart(15)} │ ${(balanceAfter.USDC - balanceBefore.USDC).toFixed(6).padStart(12)}`);
    console.log(`  GUSD  │ ${balanceBefore.GUSD.toFixed(6).padStart(15)} │ ${balanceAfter.GUSD.toFixed(6).padStart(15)} │ ${(balanceAfter.GUSD - balanceBefore.GUSD).toFixed(6).padStart(12)}`);
    console.log(`  XAUM  │ ${(balanceBefore.XAUM || 0).toFixed(6).padStart(15)} │ ${(balanceAfter.XAUM || 0).toFixed(6).padStart(15)} │ ${((balanceAfter.XAUM || 0) - (balanceBefore.XAUM || 0)).toFixed(6).padStart(12)}`);
    console.log(`${'═'.repeat(70)}\n`);
}

async function calculateRealTimeHealthFactor(address, obligationId) {
    try {
        const grBalance = await getTokenBalance(address, CONFIG.GR_TYPE);
        const suiBalance = await getTokenBalance(address, CONFIG.SUI_TYPE);
        const usdcBalance = await getTokenBalance(address, CONFIG.USDC_TYPE);
        const gusdBalance = await getTokenBalance(address, CONFIG.GUSD_TYPE);
        
        const GR_PRICE = HEALTH_FACTOR_CONFIG.PRICE.GR;
        const SUI_PRICE = HEALTH_FACTOR_CONFIG.PRICE.SUI;
        const USDC_PRICE = HEALTH_FACTOR_CONFIG.PRICE.USDC;
        const GUSD_PRICE = HEALTH_FACTOR_CONFIG.PRICE.GUSD;
        
        const grValue = grBalance * GR_PRICE;
        const usdcValue = usdcBalance * USDC_PRICE;
        const totalCollateralValue = grValue + usdcValue;
        
        const borrowValue = gusdBalance * GUSD_PRICE;
        
        const healthFactor = borrowValue > 0 ? totalCollateralValue / borrowValue : Infinity;
        
        let status = '✅ VERY SAFE';
        if (healthFactor < 1.5) status = '🚨 CRITICAL!';
        else if (healthFactor < 2.0) status = '⚠️ WARNING';
        else if (healthFactor < 10) status = '✅ SAFE';
        
        console.log(`\n📊 ═══════════════════════════════════════════════`);
        console.log(`   REAL-TIME HEALTH FACTOR SNAPSHOT`);
        console.log(`   ═══════════════════════════════════════════════`);
        console.log(`   Collateral: GR ${grBalance.toFixed(2)} ($${grValue.toFixed(2)}) + USDC ${usdcBalance.toFixed(2)} ($${usdcValue.toFixed(2)})`);
        console.log(`   Total Collateral: $${totalCollateralValue.toFixed(2)}`);
        console.log(`   Borrow: GUSD ${gusdBalance.toFixed(2)} ($${borrowValue.toFixed(2)})`);
        console.log(`   ───────────────────────────────────────────────`);
        console.log(`   Health Factor: ${healthFactor === Infinity ? '∞' : healthFactor.toFixed(2)} ${status}`);
        console.log(`   ═══════════════════════════════════════════════\n`);
        
        return healthFactor;
    } catch (error) {
        console.error(`Error calculating health factor:`, error.message);
        return Infinity;
    }
}

function updatePriceForToken(tx, tokenType, priceValue) {
    const [priceUpdateRequest] = tx.moveCall({
        target: `${CONFIG.ORACLE_PACKAGE}::x_oracle::price_update_request`,
        typeArguments: [tokenType],
        arguments: [tx.object(CONFIG.XORACLE_OBJECT)]
    });
    tx.moveCall({
        target: `${CONFIG.RULE_PACKAGE}::rule::set_price_as_primary`,
        typeArguments: [tokenType],
        arguments: [priceUpdateRequest, tx.pure(priceValue.toString(), 'u64'), tx.object(CONFIG.CLOCK_OBJECT)]
    });
    tx.moveCall({
        target: `${CONFIG.ORACLE_PACKAGE}::x_oracle::confirm_price_update_request`,
        typeArguments: [tokenType],
        arguments: [tx.object(CONFIG.XORACLE_OBJECT), priceUpdateRequest, tx.object(CONFIG.CLOCK_OBJECT)]
    });
}

// ============================================
// CLAIM FUNCTIONS
// ============================================
async function claimXaumFaucet(keypair, address, attemptNum) {
    try {
        console.log(`  💰 Claim XAUM #${attemptNum}...`);
        const tx = new TransactionBlock();
        tx.moveCall({
            target: `${CONFIG.FAUCET_PACKAGE}::coin_xaum::mint`,
            arguments: [tx.object(CONFIG.XAUM_SHARED_OBJECT), tx.pure('1000000000', 'u64'), tx.pure(address, 'address')]
        });
        tx.setGasBudget(CONFIG.GAS_BUDGET);
        const result = await suiClient.signAndExecuteTransactionBlock({ transactionBlock: tx, signer: keypair, options: { showEffects: true } });
        if (result.effects?.status?.status === 'success') {
            console.log(`  ✓ Success! TX: ${result.digest.substring(0, 10)}...`);
            await delay(getRandomDelay(10, 15), 'Next:');
            return true;
        }
        return false;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return false;
    }
}

async function claimUsdcFaucet(keypair, address, attemptNum) {
    try {
        console.log(`  💵 Claim USDC #${attemptNum}...`);
        const tx = new TransactionBlock();
        tx.moveCall({
            target: `${CONFIG.FAUCET_PACKAGE}::usdc::mint`,
            arguments: [tx.object(CONFIG.USDC_SHARED_OBJECT), tx.pure('10000000000', 'u64'), tx.pure(address, 'address')]
        });
        tx.setGasBudget(CONFIG.GAS_BUDGET);
        const result = await suiClient.signAndExecuteTransactionBlock({ transactionBlock: tx, signer: keypair, options: { showEffects: true } });
        if (result.effects?.status?.status === 'success') {
            console.log(`  ✓ Success! TX: ${result.digest.substring(0, 10)}...`);
            await delay(getRandomDelay(10, 15), 'Next:');
            return true;
        }
        return false;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return false;
    }
}

// ============================================
// SWAP FUNCTIONS
// ============================================
async function swapUsdcToGusd(keypair, address, attemptNum) {
    try {
        const randomAmount = getRandomAmount(1, 10);
        const amountDisplay = (randomAmount / CONFIG.DECIMALS).toFixed(2);
        console.log(`  🔄 Swap USDC → GUSD #${attemptNum} (${amountDisplay} USDC)...`);
        const usdcCoins = await getCoinsWithRetry(address, CONFIG.USDC_TYPE);
        if (usdcCoins.length === 0) { console.log(`  ✗ Tidak ada USDC coin`); return false; }
        const totalBalance = usdcCoins.reduce((sum, coin) => sum + BigInt(coin.balance), BigInt(0));
        if (totalBalance < BigInt(randomAmount)) { console.log(`  ✗ Balance tidak cukup`); return false; }
        const tx = new TransactionBlock();
        let coinToUse = tx.object(usdcCoins[0].coinObjectId);
        if (usdcCoins.length > 1) {
            const coinIds = usdcCoins.slice(1).map(c => tx.object(c.coinObjectId));
            tx.mergeCoins(coinToUse, coinIds);
        }
        const [splitCoin] = tx.splitCoins(coinToUse, [tx.pure(randomAmount.toString(), 'u64')]);
        tx.moveCall({
            target: `${CONFIG.GUSD_PACKAGE}::gusd_usdc_vault::mint_gusd`,
            arguments: [tx.object(CONFIG.GUSD_VAULT), tx.object(CONFIG.GUSD_MARKET), splitCoin, tx.object(CONFIG.CLOCK_OBJECT)]
        });
        tx.setGasBudget(CONFIG.GAS_BUDGET);
        const result = await suiClient.signAndExecuteTransactionBlock({ transactionBlock: tx, signer: keypair, options: { showEffects: true } });
        if (result.effects?.status?.status === 'success') {
            console.log(`  ✓ Success! TX: ${result.digest.substring(0, 10)}...`);
            await delay(getRandomDelay(10, 15), 'Next:');
            return true;
        }
        return false;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return false;
    }
}

async function swapGusdToUsdc(keypair, address, attemptNum) {
    try {
        const randomAmount = getRandomAmount(1, 3);
        const amountDisplay = (randomAmount / CONFIG.DECIMALS).toFixed(2);
        console.log(`  🔄 Swap GUSD → USDC #${attemptNum} (${amountDisplay} GUSD)...`);
        const gusdCoins = await getCoinsWithRetry(address, CONFIG.GUSD_TYPE);
        if (gusdCoins.length === 0) { console.log(`  ✗ Tidak ada GUSD coin`); return false; }
        const totalBalance = gusdCoins.reduce((sum, coin) => sum + BigInt(coin.balance), BigInt(0));
        if (totalBalance < BigInt(randomAmount)) { console.log(`  ✗ Balance tidak cukup`); return false; }
        const tx = new TransactionBlock();
        let coinToUse = tx.object(gusdCoins[0].coinObjectId);
        if (gusdCoins.length > 1) {
            const coinIds = gusdCoins.slice(1).map(c => tx.object(c.coinObjectId));
            tx.mergeCoins(coinToUse, coinIds);
        }
        const [splitCoin] = tx.splitCoins(coinToUse, [tx.pure(randomAmount.toString(), 'u64')]);
        tx.moveCall({
            target: `${CONFIG.GUSD_PACKAGE}::gusd_usdc_vault::redeem_gusd`,
            arguments: [tx.object(CONFIG.GUSD_VAULT), tx.object(CONFIG.GUSD_MARKET), splitCoin]
        });
        tx.setGasBudget(CONFIG.GAS_BUDGET);
        const result = await suiClient.signAndExecuteTransactionBlock({ transactionBlock: tx, signer: keypair, options: { showEffects: true } });
        if (result.effects?.status?.status === 'success') {
            console.log(`  ✓ Success! TX: ${result.digest.substring(0, 10)}...`);
            await delay(getRandomDelay(10, 15), 'Next:');
            return true;
        }
        return false;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return false;
    }
}

// ============================================
// STAKING FUNCTIONS
// ============================================
async function stakeXaum(keypair, address, attemptNum) {
    try {
        const randomAmount = getRandomAmount(1, 3);
        const amountDisplay = (randomAmount / CONFIG.DECIMALS).toFixed(2);
        console.log(`  🔒 Stake XAUM #${attemptNum} (${amountDisplay} XAUM)...`);
        const xaumCoins = await getCoinsWithRetry(address, CONFIG.XAUM_TYPE);
        if (xaumCoins.length === 0) return false;
        const totalBalance = xaumCoins.reduce((sum, coin) => sum + BigInt(coin.balance), BigInt(0));
        if (totalBalance < BigInt(randomAmount)) return false;
        const tx = new TransactionBlock();
        let coinToUse = tx.object(xaumCoins[0].coinObjectId);
        if (xaumCoins.length > 1) {
            const coinIds = xaumCoins.slice(1).map(c => tx.object(c.coinObjectId));
            tx.mergeCoins(coinToUse, coinIds);
        }
        const [splitCoin] = tx.splitCoins(coinToUse, [tx.pure(randomAmount.toString(), 'u64')]);
        tx.moveCall({ target: `${CONFIG.GUSD_PACKAGE}::staking_manager::stake_xaum`, arguments: [tx.object(CONFIG.STAKING_MANAGER), splitCoin] });
        tx.setGasBudget(CONFIG.GAS_BUDGET);
        const result = await suiClient.signAndExecuteTransactionBlock({ transactionBlock: tx, signer: keypair, options: { showEffects: true } });
        if (result.effects?.status?.status === 'success') {
            console.log(`  ✓ Success! TX: ${result.digest.substring(0, 10)}...`);
            await delay(getRandomDelay(10, 15), 'Next:');
            return true;
        }
        return false;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return false;
    }
}

async function redeemXaum(keypair, address, attemptNum) {
    try {
        const randomAmount = getRandomAmount(0.1, 1);
        const amountDisplay = (randomAmount / CONFIG.DECIMALS).toFixed(2);
        console.log(`  🔓 Redeem XAUM #${attemptNum} (${amountDisplay} XAUM)...`);
        const grCoins = await getCoinsWithRetry(address, CONFIG.GR_TYPE);
        if (grCoins.length === 0) return false;
        const gyCoins = await getCoinsWithRetry(address, CONFIG.GY_TYPE);
        if (gyCoins.length === 0) return false;
        const gyAmount = randomAmount * 100;
        const grAmount = randomAmount * 100;
        const gyBalance = gyCoins.reduce((sum, coin) => sum + BigInt(coin.balance), BigInt(0));
        const grBalance = grCoins.reduce((sum, coin) => sum + BigInt(coin.balance), BigInt(0));
        if (gyBalance < BigInt(gyAmount) || grBalance < BigInt(grAmount)) return false;
        const tx = new TransactionBlock();
        let grCoinToUse = tx.object(grCoins[0].coinObjectId);
        if (grCoins.length > 1) {
            const grCoinIds = grCoins.slice(1).map(c => tx.object(c.coinObjectId));
            tx.mergeCoins(grCoinToUse, grCoinIds);
        }
        let gyCoinToUse = tx.object(gyCoins[0].coinObjectId);
        if (gyCoins.length > 1) {
            const gyCoinIds = gyCoins.slice(1).map(c => tx.object(c.coinObjectId));
            tx.mergeCoins(gyCoinToUse, gyCoinIds);
        }
        const [grToRedeem] = tx.splitCoins(grCoinToUse, [tx.pure(grAmount.toString(), 'u64')]);
        const [gyToRedeem] = tx.splitCoins(gyCoinToUse, [tx.pure(gyAmount.toString(), 'u64')]);
        tx.moveCall({
            target: `${CONFIG.GUSD_PACKAGE}::staking_manager::unstake`,
            arguments: [tx.object(CONFIG.STAKING_MANAGER), grToRedeem, gyToRedeem]
        });
        tx.setGasBudget(CONFIG.GAS_BUDGET);
        const result = await suiClient.signAndExecuteTransactionBlock({ transactionBlock: tx, signer: keypair, options: { showEffects: true } });
        if (result.effects?.status?.status === 'success') {
            console.log(`  ✓ Success! TX: ${result.digest.substring(0, 10)}...`);
            await delay(getRandomDelay(10, 15), 'Next:');
            return true;
        }
        return false;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return false;
    }
}

// ============================================
// DEPOSIT FUNCTIONS
// ============================================
async function depositGrCollateral(keypair, address, attemptNum, obligationId = null, obligationKeyId = null) {
    try {
        console.log(`  📥 Deposit GR #${attemptNum}...`);
        const grCoins = await getCoinsWithRetry(address, CONFIG.GR_TYPE);
        if (grCoins.length === 0) { console.log(`  ✗ Tidak ada GR coin`); return { success: false, obligationId, obligationKeyId }; }
        const totalBalance = grCoins.reduce((sum, coin) => sum + BigInt(coin.balance), BigInt(0));
        const safeDepositAmount = calculateSafeDepositAmount(Number(totalBalance), 'GR');
        console.log(`  📊 GR Balance: ${Number(totalBalance) / CONFIG.DECIMALS}`);
        console.log(`  🎯 Safe Deposit: ${safeDepositAmount / CONFIG.DECIMALS} GR (HF Safe)`);
        if (safeDepositAmount <= 0) { console.log(`  ✗ Balance terlalu kecil`); return { success: false, obligationId, obligationKeyId }; }
        const tx = new TransactionBlock();
        let grCoinToUse = tx.object(grCoins[0].coinObjectId);
        if (grCoins.length > 1) {
            const grCoinIds = grCoins.slice(1).map(c => tx.object(c.coinObjectId));
            tx.mergeCoins(grCoinToUse, grCoinIds);
        }
        if (!obligationId) {
            const [newObligation, newObligationKey, obligationAccessCap] = tx.moveCall({
                target: `${CONFIG.LENDING_PACKAGE}::open_obligation::open_obligation`,
                arguments: [tx.object(CONFIG.PROTOCOL_OBJECT)]
            });
            const [splitGr] = tx.splitCoins(grCoinToUse, [tx.pure(safeDepositAmount.toString(), 'u64')]);
            tx.moveCall({
                target: `${CONFIG.LENDING_PACKAGE}::deposit_collateral::deposit_collateral`,
                typeArguments: [CONFIG.GR_TYPE],
                arguments: [tx.object(CONFIG.PROTOCOL_OBJECT), newObligation, tx.object(CONFIG.LENDING_MARKET), splitGr]
            });
            tx.transferObjects([newObligationKey], tx.pure(address, 'address'));
            tx.moveCall({
                target: `${CONFIG.LENDING_PACKAGE}::open_obligation::return_obligation`,
                arguments: [tx.object(CONFIG.PROTOCOL_OBJECT), newObligation, obligationAccessCap]
            });
        } else {
            const [splitGr] = tx.splitCoins(grCoinToUse, [tx.pure(safeDepositAmount.toString(), 'u64')]);
            tx.moveCall({
                target: `${CONFIG.LENDING_PACKAGE}::deposit_collateral::deposit_collateral`,
                typeArguments: [CONFIG.GR_TYPE],
                arguments: [tx.object(CONFIG.PROTOCOL_OBJECT), tx.object(obligationId), tx.object(CONFIG.LENDING_MARKET), splitGr]
            });
        }
        tx.setGasBudget(CONFIG.GAS_BUDGET);
        const result = await suiClient.signAndExecuteTransactionBlock({
            transactionBlock: tx,
            signer: keypair,
            options: { showEffects: true, showEvents: true, showObjectChanges: true }
        });
        if (result.effects?.status?.status === 'success') {
            console.log(`  ✓ Success! TX: ${result.digest.substring(0, 10)}...`);
            let newObligationId = obligationId;
            let newObligationKeyId = obligationKeyId;
            if (!obligationId) {
                if (result.events) {
                    const createdEvent = result.events.find(e => e.type && e.type.includes('ObligationCreatedEvent'));
                    if (createdEvent && createdEvent.parsedJson) {
                        newObligationId = createdEvent.parsedJson.obligation;
                        newObligationKeyId = createdEvent.parsedJson.obligationkey || createdEvent.parsedJson.obligation_key;
                        console.log(`  🆔 Obligation: ${newObligationId}`);
                        console.log(`  🔑 Key: ${newObligationKeyId}`);
                    }
                }
                if (!newObligationId && result.objectChanges) {
                    for (const change of result.objectChanges) {
                        if (change.type === 'created' && change.objectType) {
                            if (change.objectType.includes('::obligation::Obligation')) {
                                newObligationId = change.objectId;
                                console.log(`  🆔 Obligation: ${newObligationId}`);
                            }
                            if (change.objectType.includes('ObligationKey')) {
                                newObligationKeyId = change.objectId;
                                console.log(`  🔑 Key: ${newObligationKeyId}`);
                            }
                        }
                    }
                }
            }
            await delay(getRandomDelay(10, 15), 'Next:');
            return { success: true, obligationId: newObligationId, obligationKeyId: newObligationKeyId };
        } else {
            console.log(`  ✗ Failed: ${result.effects?.status?.error || 'Unknown error'}`);
            return { success: false, obligationId, obligationKeyId };
        }
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return { success: false, obligationId, obligationKeyId };
    }
}

async function depositSuiCollateral(keypair, address, attemptNum, obligationId) {
    try {
        console.log(`  📥 Deposit SUI #${attemptNum}...`);
        if (!obligationId) return false;
        
        const suiBalance = await getSuiBalance(address);
        const suiBalanceRaw = suiBalance * CONFIG.DECIMALS;
        
        const randomSuiAmount = getRandomAmount(0.1, 0.5);
        const maxDepositSui = randomSuiAmount;
        const safeDepositAmount = Math.min(
            calculateSafeDepositAmount(suiBalanceRaw, 'SUI'),
            maxDepositSui
        );
        
        console.log(`  📊 SUI Balance: ${suiBalance.toFixed(6)} SUI`);
        console.log(`  🎯 Safe Deposit: ${(safeDepositAmount / CONFIG.DECIMALS).toFixed(6)} SUI (max ${(maxDepositSui / CONFIG.DECIMALS).toFixed(1)} SUI)`);
        
        if (safeDepositAmount <= 0) {
            console.log(`  ✗ Deposit amount too small`);
            return false;
        }
        
        const tx = new TransactionBlock();
        const [splitSui] = tx.splitCoins(tx.gas, [tx.pure(safeDepositAmount.toString(), 'u64')]);
        tx.moveCall({
            target: `${CONFIG.LENDING_PACKAGE}::deposit_collateral::deposit_collateral`,
            typeArguments: [CONFIG.SUI_TYPE],
            arguments: [tx.object(CONFIG.PROTOCOL_OBJECT), tx.object(obligationId), tx.object(CONFIG.LENDING_MARKET), splitSui]
        });
        tx.setGasBudget(CONFIG.GAS_BUDGET);
        const result = await suiClient.signAndExecuteTransactionBlock({ transactionBlock: tx, signer: keypair, options: { showEffects: true } });
        if (result.effects?.status?.status === 'success') {
            console.log(`  ✓ Success! TX: ${result.digest.substring(0, 10)}...`);
            await delay(getRandomDelay(10, 15), 'Next:');
            return true;
        }
        return false;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return false;
    }
}

async function depositUsdcCollateral(keypair, address, attemptNum, obligationId) {
    try {
        console.log(`  📥 Deposit USDC #${attemptNum}...`);
        if (!obligationId) return false;
        const usdcCoins = await getCoinsWithRetry(address, CONFIG.USDC_TYPE);
        if (usdcCoins.length === 0) return false;
        const totalBalance = usdcCoins.reduce((sum, coin) => sum + BigInt(coin.balance), BigInt(0));
        const safeDepositAmount = calculateSafeDepositAmount(Number(totalBalance), 'USDC');
        console.log(`  📊 USDC Balance: ${Number(totalBalance) / CONFIG.DECIMALS}`);
        console.log(`  🎯 Safe Deposit: ${safeDepositAmount / CONFIG.DECIMALS} USDC (HF Safe)`);
        if (safeDepositAmount <= 0) return false;
        const tx = new TransactionBlock();
        let usdcCoinToUse = tx.object(usdcCoins[0].coinObjectId);
        if (usdcCoins.length > 1) {
            const usdcCoinIds = usdcCoins.slice(1).map(c => tx.object(c.coinObjectId));
            tx.mergeCoins(usdcCoinToUse, usdcCoinIds);
        }
        const [splitUsdc] = tx.splitCoins(usdcCoinToUse, [tx.pure(safeDepositAmount.toString(), 'u64')]);
        tx.moveCall({
            target: `${CONFIG.LENDING_PACKAGE}::deposit_collateral::deposit_collateral`,
            typeArguments: [CONFIG.USDC_TYPE],
            arguments: [tx.object(CONFIG.PROTOCOL_OBJECT), tx.object(obligationId), tx.object(CONFIG.LENDING_MARKET), splitUsdc]
        });
        tx.setGasBudget(CONFIG.GAS_BUDGET);
        const result = await suiClient.signAndExecuteTransactionBlock({ transactionBlock: tx, signer: keypair, options: { showEffects: true } });
        if (result.effects?.status?.status === 'success') {
            console.log(`  ✓ Success! TX: ${result.digest.substring(0, 10)}...`);
            await delay(getRandomDelay(10, 15), 'Next:');
            return true;
        }
        return false;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return false;
    }
}

// ============================================
// BORROW & REPAY FUNCTIONS
// ============================================
async function borrowGusd(keypair, address, attemptNum, obligationId, obligationKeyId) {
    try {
        console.log(`  💸 Borrow GUSD #${attemptNum}...`);
        if (!obligationId || !obligationKeyId) return false;
        
        const borrowAmount = 50000000000;
        console.log(`  🎯 Borrow: ${(borrowAmount / CONFIG.DECIMALS).toFixed(2)} GUSD (HF Safe > 1.5)`);
        
        const tx = new TransactionBlock();
        
        updatePriceForToken(tx, CONFIG.GR_TYPE, '150500000000');
        updatePriceForToken(tx, CONFIG.SUI_TYPE, '3180000000');
        updatePriceForToken(tx, CONFIG.USDC_TYPE, '1000000000');
        updatePriceForToken(tx, CONFIG.GUSD_TYPE, '1050000000');
        
        tx.moveCall({
            target: `${CONFIG.LENDING_PACKAGE}::borrow::borrow_entry`,
            arguments: [
                tx.object(CONFIG.PROTOCOL_OBJECT),
                tx.object(obligationId),
                tx.object(obligationKeyId),
                tx.object(CONFIG.LENDING_MARKET),
                tx.object(CONFIG.PRICE_ORACLE),
                tx.pure(borrowAmount, 'u64'),
                tx.object(CONFIG.XORACLE_OBJECT),
                tx.object(CONFIG.CLOCK_OBJECT)
            ]
        });
        
        tx.setGasBudget(CONFIG.GAS_BUDGET);
        
        const result = await suiClient.signAndExecuteTransactionBlock({
            transactionBlock: tx,
            signer: keypair,
            options: { showEffects: true }
        });
        
        if (result.effects?.status?.status === 'success') {
            console.log(`  ✓ Success! TX: ${result.digest.substring(0, 10)}...`);
            await delay(getRandomDelay(10, 15), 'Next:');
            return true;
        }
        console.log(`  ✗ Failed: ${result.effects?.status?.error}`);
        return false;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return false;
    }
}

async function repayGusd(keypair, address, attemptNum, obligationId) {
    try {
        console.log(`  💰 Repay GUSD #${attemptNum}...`);
        if (!obligationId) return false;
        
        const gusdCoins = await getCoinsWithRetry(address, CONFIG.GUSD_TYPE);
        if (gusdCoins.length === 0) {
            console.log(`  ✗ No GUSD coins`);
            return false;
        }
        
        const totalBalance = gusdCoins.reduce((sum, coin) => sum + BigInt(coin.balance), BigInt(0));
        const repayAmount = Math.min(
            Math.floor(Number(totalBalance) * 0.5),
            10000000000
        );
        
        console.log(`  🎯 Repay: ${repayAmount / CONFIG.DECIMALS} GUSD (HF Safe > 1.5)`);
        if (repayAmount <= 0) return false;
        
        const tx = new TransactionBlock();
        
        let gusdCoinToUse = tx.object(gusdCoins[0].coinObjectId);
        if (gusdCoins.length > 1) {
            const gusdCoinIds = gusdCoins.slice(1).map(c => tx.object(c.coinObjectId));
            tx.mergeCoins(gusdCoinToUse, gusdCoinIds);
        }
        
        const [splitGusd] = tx.splitCoins(gusdCoinToUse, [tx.pure(repayAmount, 'u64')]);
        
        tx.moveCall({
            target: `${CONFIG.LENDING_PACKAGE}::repay::repay`,
            typeArguments: [CONFIG.GUSD_TYPE],
            arguments: [
                tx.object(CONFIG.PROTOCOL_OBJECT),
                tx.object(obligationId),
                tx.object(CONFIG.LENDING_MARKET),
                splitGusd,
                tx.object(CONFIG.CLOCK_OBJECT)
            ]
        });
        
        tx.setGasBudget(CONFIG.GAS_BUDGET);
        
        const result = await suiClient.signAndExecuteTransactionBlock({
            transactionBlock: tx,
            signer: keypair,
            options: { showEffects: true }
        });
        
        if (result.effects?.status?.status === 'success') {
            console.log(`  ✓ Success! TX: ${result.digest.substring(0, 10)}...`);
            await delay(getRandomDelay(10, 15), 'Next:');
            return true;
        }
        console.log(`  ✗ Failed: ${result.effects?.status?.error}`);
        return false;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return false;
    }
}

// ============================================
// WITHDRAW FUNCTION
// ============================================
async function withdrawGrCollateral(keypair, address, obligationId, obligationKeyId) {
    try {
        console.log(`  📤 Withdraw GR...`);
        if (!obligationId || !obligationKeyId) return false;
        
        const tx = new TransactionBlock();
        
        updatePriceForToken(tx, CONFIG.GR_TYPE, '150500000000');
        updatePriceForToken(tx, CONFIG.SUI_TYPE, '3180000000');
        updatePriceForToken(tx, CONFIG.USDC_TYPE, '1000000000');
        updatePriceForToken(tx, CONFIG.GUSD_TYPE, '1050000000');
        
        tx.moveCall({
            target: `${CONFIG.LENDING_PACKAGE}::withdraw_collateral::withdraw_collateral_entry`,
            typeArguments: [CONFIG.GR_TYPE],
            arguments: [
                tx.object(CONFIG.PROTOCOL_OBJECT),
                tx.object(obligationId),
                tx.object(obligationKeyId),
                tx.object(CONFIG.LENDING_MARKET),
                tx.object(CONFIG.PRICE_ORACLE),
                tx.pure('1000000', 'u64'),
                tx.object(CONFIG.XORACLE_OBJECT),
                tx.object(CONFIG.CLOCK_OBJECT)
            ]
        });
        
        tx.setGasBudget(CONFIG.GAS_BUDGET);
        const result = await suiClient.signAndExecuteTransactionBlock({
            transactionBlock: tx,
            signer: keypair,
            options: { showEffects: true }
        });
        
        if (result.effects?.status?.status === 'success') {
            console.log(`  ✓ Success! TX: ${result.digest.substring(0, 10)}...`);
            await delay(getRandomDelay(10, 15), 'Next:');
            return true;
        }
        console.log(`  ✗ Failed: ${result.effects?.status?.error}`);
        return false;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return false;
    }
}

// ============================================
// PROCESS WALLET
// ============================================
async function processWallet(keypair, address, walletIndex, totalWallets, proxyUrl) {
    console.log(`\n╔════════════════════════════════════════════════╗`);
    console.log(`║  WALLET ${walletIndex}/${totalWallets}`);
    console.log(`╚════════════════════════════════════════════════╝`);
    console.log(`Address: ${address}`);
    if (proxyUrl) {
        console.log(`Proxy: ${proxyUrl}`);
    } else {
        console.log(`Proxy: 🌍 Local IP`);
    }
    console.log();
    
    const balanceBefore = await getWalletBalances(address);
    console.log(`\n✅ Initial Balance Snapshot:`);
    console.log(`   GR: ${balanceBefore.GR.toFixed(2)}, SUI: ${balanceBefore.SUI.toFixed(6)}, USDC: ${balanceBefore.USDC.toFixed(2)}, GUSD: ${balanceBefore.GUSD.toFixed(2)}`);
    
    let stats = { xaumClaims: 0, usdcClaims: 0, swapUsdcToGusd: 0, swapGusdToUsdc: 0, stakes: 0, redeems: 0, depositGr: 0, depositSui: 0, depositUsdc: 0, borrowGusd: 0, repayGusd: 0, withdrawGr: 0 };
    let obligationId = null;
    let obligationKeyId = null;
    try {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📍 STEP 1: Check & Get SUI Balance');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const suiFaucetSuccess = await ensureSuiFaucet(address);
        if (!suiFaucetSuccess) { console.log('❌ Gagal mendapatkan SUI\n'); return { success: false, stats, balanceBefore, balanceAfter: null }; }
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📍 STEP 2: Claim XAUM (3x)');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        for (let i = 1; i <= CONFIG.XAUM_CLAIM_COUNT; i++) { if (await claimXaumFaucet(keypair, address, i)) stats.xaumClaims++; }
        console.log(`\n📊 XAUM Claims: ${stats.xaumClaims}/${CONFIG.XAUM_CLAIM_COUNT}`);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📍 STEP 3: Claim USDC (3x)');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        for (let i = 1; i <= CONFIG.USDC_CLAIM_COUNT; i++) { if (await claimUsdcFaucet(keypair, address, i)) stats.usdcClaims++; }
        console.log(`\n📊 USDC Claims: ${stats.usdcClaims}/${CONFIG.USDC_CLAIM_COUNT}`);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📍 STEP 4: Swap USDC → GUSD (3x) - HF Safe');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        for (let i = 1; i <= CONFIG.SWAP_USDC_TO_GUSD_COUNT; i++) { if (await swapUsdcToGusd(keypair, address, i)) stats.swapUsdcToGusd++; }
        console.log(`\n📊 Swaps: ${stats.swapUsdcToGusd}/${CONFIG.SWAP_USDC_TO_GUSD_COUNT}`);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📍 STEP 5: Swap GUSD → USDC (1x) - HF Safe');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        for (let i = 1; i <= CONFIG.SWAP_GUSD_TO_USDC_COUNT; i++) { if (await swapGusdToUsdc(keypair, address, i)) stats.swapGusdToUsdc++; }
        console.log(`\n📊 Swaps: ${stats.swapGusdToUsdc}/${CONFIG.SWAP_GUSD_TO_USDC_COUNT}`);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📍 STEP 6: Stake XAUM (3x)');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        for (let i = 1; i <= CONFIG.STAKE_XAUM_COUNT; i++) { if (await stakeXaum(keypair, address, i)) stats.stakes++; }
        console.log(`\n📊 Stakes: ${stats.stakes}/${CONFIG.STAKE_XAUM_COUNT}`);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📍 STEP 7: Redeem XAUM (3x)');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        for (let i = 1; i <= CONFIG.REDEEM_XAUM_COUNT; i++) { if (await redeemXaum(keypair, address, i)) stats.redeems++; }
        console.log(`\n📊 Redeems: ${stats.redeems}/${CONFIG.REDEEM_XAUM_COUNT}`);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📍 STEP 8: LENDING - Open Obligation & Deposit GR #1');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const result1 = await depositGrCollateral(keypair, address, 1, obligationId, obligationKeyId);
        if (result1.success) {
            stats.depositGr++;
            if (result1.obligationId) {
                obligationId = result1.obligationId;
                obligationKeyId = result1.obligationKeyId;
                console.log(`  🔑 Obligation created & saved!`);
                console.log(`  🆔 Using Obligation: ${obligationId}`);
                console.log(`  🔑 Using Key: ${obligationKeyId}\n`);
                if (CONFIG.DEPOSIT_GR_COUNT > 1) {
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                    console.log('📍 STEP 8b: Deposit GR #2-3');
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                    for (let i = 2; i <= CONFIG.DEPOSIT_GR_COUNT; i++) {
                        const result = await depositGrCollateral(keypair, address, i, obligationId, obligationKeyId);
                        if (result.success) stats.depositGr++;
                    }
                }
                console.log(`\n📊 Deposit GR: ${stats.depositGr}/${CONFIG.DEPOSIT_GR_COUNT}`);
                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('📍 STEP 9: Deposit SUI (3x) - Random 0.1-0.5 SUI');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                for (let i = 1; i <= CONFIG.DEPOSIT_SUI_COUNT; i++) { if (await depositSuiCollateral(keypair, address, i, obligationId)) stats.depositSui++; }
                console.log(`\n📊 Deposit SUI: ${stats.depositSui}/${CONFIG.DEPOSIT_SUI_COUNT}`);
                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('📍 STEP 10: Deposit USDC (3x) - HF Safe');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                for (let i = 1; i <= CONFIG.DEPOSIT_USDC_COUNT; i++) { if (await depositUsdcCollateral(keypair, address, i, obligationId)) stats.depositUsdc++; }
                console.log(`\n📊 Deposit USDC: ${stats.depositUsdc}/${CONFIG.DEPOSIT_USDC_COUNT}`);
                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('📍 STEP 11: Borrow GUSD (3x) - HF Safe > 1.5');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                for (let i = 1; i <= CONFIG.BORROW_GUSD_COUNT; i++) { if (await borrowGusd(keypair, address, i, obligationId, obligationKeyId)) stats.borrowGusd++; }
                console.log(`\n📊 Borrow: ${stats.borrowGusd}/${CONFIG.BORROW_GUSD_COUNT}`);
                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('📍 STEP 12: Repay GUSD (3x) - HF Safe > 1.5');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                for (let i = 1; i <= CONFIG.REPAY_GUSD_COUNT; i++) { if (await repayGusd(keypair, address, i, obligationId)) stats.repayGusd++; }
                console.log(`📊 Repay: ${stats.repayGusd}/${CONFIG.REPAY_GUSD_COUNT}`);
                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('📍 STEP 13: Withdraw GR (3x dengan price update!)');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                for (let i = 1; i <= CONFIG.WITHDRAW_COUNT; i++) {
                    if (await withdrawGrCollateral(keypair, address, obligationId, obligationKeyId)) stats.withdrawGr++;
                }
                console.log(`📊 Withdraw GR: ${stats.withdrawGr}/3`);
            }
        }
        
        const balanceAfter = await getWalletBalances(address);
        printBalanceReport(address, balanceBefore, balanceAfter);
        
        if (obligationId) {
            const finalHF = await calculateRealTimeHealthFactor(address, obligationId);
            if (finalHF < 1.5) {
                console.log(`\n🚨 WARNING: Health Factor CRITICAL! (${finalHF.toFixed(2)} < 1.5)`);
                console.log(`   STOP operations to prevent liquidation!`);
            }
        }
        
        console.log('\n✅ Wallet berhasil diproses!');
        return { success: true, stats, balanceBefore, balanceAfter };
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        const balanceAfter = await getWalletBalances(address);
        return { success: false, stats, balanceBefore, balanceAfter };
    }
}

// ============================================
// MAIN SCHEDULER - DAILY RUN (ONCE PER DAY)
// ============================================
async function runDailyBot() {
    const startTime = new Date();
    let dayCount = 1;
    
    // LOAD PROXY MAPPINGS SATU KALI
    const proxyMappings = readProxyMappings(CONFIG.PROXY_FILE);
    
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  🤖 BOT AKAN BERJALAN 1 KALI SETIAP HARI (24 JAM LOOP)`);
    console.log(`  🟢 Start Time: ${startTime.toLocaleString()}`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`  📋 PROXY CONFIGURATION LOADED`);
    console.log(`${'═'.repeat(70)}`);
    Object.entries(proxyMappings).forEach(([key, proxy]) => {
        if (proxy) {
            console.log(`  ${key}: ${proxy}`);
        } else {
            console.log(`  ${key}: LOCAL IP (empty line)`);
        }
    });
    console.log();
    
    while (true) {
        const runStartTime = new Date();
        console.log(`\n${'═'.repeat(70)}`);
        console.log(`  📅 DAY #${dayCount} - ${runStartTime.toLocaleDateString()}`);
        console.log(`  🟢 Mulai: ${runStartTime.toLocaleString()}`);
        console.log(`${'═'.repeat(70)}\n`);
        
        const privateKeys = readPrivateKeys();
        if (privateKeys.length === 0) { 
            console.log('❌ Tidak ada private key!'); 
            break; 
        }
        
        let totalStats = { 
            success: 0, failed: 0, xaumClaims: 0, usdcClaims: 0, swapUsdcToGusd: 0, 
            swapGusdToUsdc: 0, stakes: 0, redeems: 0, depositGr: 0, depositSui: 0, 
            depositUsdc: 0, borrowGusd: 0, repayGusd: 0, withdrawGr: 0 
        };
        
        // PROSES SEMUA WALLET (1 CYCLE PER DAY)
        console.log(`🔄 Memproses ${privateKeys.length} wallet...\n`);
        for (let idx = 0; idx < privateKeys.length; idx++) {
            const wallet = importWallet(privateKeys[idx]);
            if (!wallet) { 
                console.log(`\n❌ Gagal import wallet #${idx + 1}\n`); 
                totalStats.failed++; 
                continue; 
            }
            
            // GET PROXY UNTUK WALLET INI
            const proxyUrl = getProxyForWallet(idx + 1, proxyMappings);
            
            const result = await processWallet(wallet.keypair, wallet.address, idx + 1, privateKeys.length, proxyUrl);
            if (result.success) { totalStats.success++; } else { totalStats.failed++; }
            Object.keys(result.stats).forEach(key => { totalStats[key] += result.stats[key]; });
            if (idx < privateKeys.length - 1) { await delay(getRandomDelay(30, 60), 'Next wallet:'); }
        }
        
        const runEndTime = new Date();
        const processDuration = Math.floor((runEndTime.getTime() - runStartTime.getTime()) / 1000 / 60);
        
        // ========================================
        // STATISTIK DAY SELESAI
        // ========================================
        console.log(`\n${'═'.repeat(70)}`);
        console.log(`  ✅ DAY #${dayCount} SELESAI!`);
        console.log(`${'═'.repeat(70)}`);
        console.log(`  🟢 Mulai: ${runStartTime.toLocaleString()}`);
        console.log(`  🔴 Selesai: ${runEndTime.toLocaleString()}`);
        console.log(`  ⏱️ Durasi: ${processDuration} menit`);
        console.log(`${'─'.repeat(70)}`);
        console.log('  📊 STATISTIK:');
        console.log(`    🎯 Total: ${privateKeys.length} | ✓ ${totalStats.success} | ✗ ${totalStats.failed}`);
        console.log(`    💰 XAUM: ${totalStats.xaumClaims}/${privateKeys.length * CONFIG.XAUM_CLAIM_COUNT} | 💵 USDC: ${totalStats.usdcClaims}/${privateKeys.length * CONFIG.USDC_CLAIM_COUNT}`);
        console.log(`    🔄 Swaps: ${totalStats.swapUsdcToGusd}/${privateKeys.length * CONFIG.SWAP_USDC_TO_GUSD_COUNT} + ${totalStats.swapGusdToUsdc}/${privateKeys.length * CONFIG.SWAP_GUSD_TO_USDC_COUNT}`);
        console.log(`    🔒 Stakes: ${totalStats.stakes}/${privateKeys.length * CONFIG.STAKE_XAUM_COUNT} | 🔓 Redeems: ${totalStats.redeems}/${privateKeys.length * CONFIG.REDEEM_XAUM_COUNT}`);
        console.log(`    📥 Deposits: GR=${totalStats.depositGr}/${privateKeys.length * CONFIG.DEPOSIT_GR_COUNT} SUI=${totalStats.depositSui}/${privateKeys.length * CONFIG.DEPOSIT_SUI_COUNT} USDC=${totalStats.depositUsdc}/${privateKeys.length * CONFIG.DEPOSIT_USDC_COUNT}`);
        console.log(`    💸 Borrow: ${totalStats.borrowGusd}/${privateKeys.length * CONFIG.BORROW_GUSD_COUNT} | 💰 Repay: ${totalStats.repayGusd}/${privateKeys.length * CONFIG.REPAY_GUSD_COUNT}`);
        console.log(`    📤 Withdraws: GR=${totalStats.withdrawGr}/${privateKeys.length * CONFIG.WITHDRAW_COUNT}`);
        console.log(`${'═'.repeat(70)}\n`);
        
        // ========================================
        // HITUNG DELAY 24 JAM SAMPAI BESOK
        // ========================================
        const duration24Hours = 24 * 60 * 60 * 1000;
        const nextRunTime = new Date(runStartTime.getTime() + duration24Hours);
        const waitTime = nextRunTime.getTime() - Date.now();
        const waitHours = Math.floor(waitTime / 1000 / 60 / 60);
        const waitMinutes = Math.floor((waitTime % (1000 * 60 * 60)) / 1000 / 60);
        
        console.log(`\n${'═'.repeat(70)}`);
        console.log(`  ⏰ MENUNGGU 24 JAM SAMPAI BESOK...`);
        console.log(`${'═'.repeat(70)}`);
        console.log(`  📅 Hari ini: ${runStartTime.toLocaleDateString()}`);
        console.log(`  🔄 Next run: ${nextRunTime.toLocaleString()}`);
        console.log(`  ⏱️ Tunggu: ${waitHours} jam ${waitMinutes} menit`);
        console.log(`  💤 Bot akan otomatis jalan lagi besok hari yang sama`);
        console.log(`${'═'.repeat(70)}\n`);
        
        // TUNGGU 24 JAM SAMPAI BESOK
        await delay(waitTime, `Menunggu sampai ${nextRunTime.toLocaleString()}`);
        
        dayCount++;
        console.log('\n═══════════════════════════════════════════════════');
    }
}

// ============================================
// MAIN ENTRY POINT
// ============================================
async function main() {
    console.log('\n%cAUTO BOT CREEK FINANCE - SUI TESTNET (FINAL)', 'color: cyan; font-weight: bold; font-size: 14px');
    console.log('%cby AI Generated\n', 'color: gray; font-size: 12px');
    
    runDailyBot().catch(error => {
        console.error('Fatal Error:', error.message);
        process.exit(1);
    });
}

main();
