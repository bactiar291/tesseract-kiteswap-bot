#!/usr/bin/env node

const { ethers } = require("ethers");
const chalk = require("chalk");
const figlet = require("figlet");
const inquirer = require("inquirer");
const ora = require("ora");
const gradient = require("gradient-string");
const cliProgress = require("cli-progress");
require('dotenv').config();

// Konfigurasi jaringan
const RPC_URL = "https://rpc-testnet.gokite.ai/";
const CHAIN_ID = 2368;
const UNIV2CELL_ADDRESS = "0x04CfcA82fDf5F4210BC90f06C44EF25Bf743D556";

// Alamat token
const WKITE_ADDRESS = "0x3bC8f037691Ce1d28c0bB224BD33563b49F99dE8";
const USDT_ADDRESS = "0x0fF5393387AD2f9f691Fd6fD28E07E3969e27e63";

// ABI
const UNIV2CELL_ABI = [
    "function route(uint256 amountIn, address tokenIn, address tokenOut, bytes memory data) view returns (bytes memory trade, uint256 gasEstimate)",
    "function calculateFees(tuple(uint256 sourceId, address receiver, bool payableReceiver, address rollbackReceiver, uint256 rollbackTeleporterFee, uint256 rollbackGasLimit, tuple(uint8 action, uint256 requiredGasLimit, uint256 recipientGasLimit, bytes trade, tuple(address bridgeSourceChain, bool sourceBridgeIsNative, address bridgeDestinationChain, address cellDestinationChain, bytes32 destinationBlockchainID, uint256 teleporterFee, uint256 secondaryTeleporterFee) bridgePath)[] hops) instructions, uint256 amount) view returns (uint256 fixedNativeFee, uint256 baseFee)",
    "function initiate(address token, uint256 amount, tuple(uint256 sourceId, address receiver, bool payableReceiver, address rollbackReceiver, uint256 rollbackTeleporterFee, uint256 rollbackGasLimit, tuple(uint8 action, uint256 requiredGasLimit, uint256 recipientGasLimit, bytes trade, tuple(address bridgeSourceChain, bool sourceBridgeIsNative, address bridgeDestinationChain, address cellDestinationChain, bytes32 destinationBlockchainID, uint256 teleporterFee, uint256 secondaryTeleporterFee) bridgePath)[] hops) instructions) payable"
];

// Banner animasi
function showBanner() {
    console.clear();
    
    // Banner gradient
    const bannerGradient = gradient('magenta', 'blue', 'cyan');
    console.log(bannerGradient(figlet.textSync('Tesseract Kite Swap', {
        font: 'Standard',
        horizontalLayout: 'full',
        verticalLayout: 'default'
    })));
    
    console.log(bannerGradient(figlet.textSync('by bactiar291', {
        font: 'Small',
        horizontalLayout: 'full'
    })));
    
    console.log('\n');
}

// Fungsi untuk menjalankan swap
async function runSwap(wallet, uniV2Cell, transactionNum, totalTransactions) {
    const spinner = ora({
        text: chalk.cyan(`[${transactionNum}/${totalTransactions}] Menyiapkan transaksi swap...`),
        spinner: 'dots'
    }).start();
    
    try {
        // 1. Konfigurasi swap
        const amountIn = ethers.utils.parseEther("0.000001");
        const slippageBips = 300;

        // 2. Siapkan data untuk fungsi route
        const extrasData = ethers.utils.defaultAbiCoder.encode(
            ["uint256"], 
            [slippageBips]
        );

        // 3. Dapatkan data trade
        spinner.text = chalk.cyan(`[${transactionNum}/${totalTransactions}] Mendapatkan data trade...`);
        let tradeData, gasEstimate;
        [tradeData, gasEstimate] = await uniV2Cell.route(
            amountIn,
            WKITE_ADDRESS,
            USDT_ADDRESS,
            extrasData
        );

        // 4. Konstruksi instruksi swap
        spinner.text = chalk.cyan(`[${transactionNum}/${totalTransactions}] Membuat instruksi swap...`);
        const swapHop = {
            action: 3,
            requiredGasLimit: gasEstimate,
            recipientGasLimit: 0,
            trade: tradeData,
            bridgePath: {
                bridgeSourceChain: ethers.constants.AddressZero,
                sourceBridgeIsNative: false,
                bridgeDestinationChain: ethers.constants.AddressZero,
                cellDestinationChain: ethers.constants.AddressZero,
                destinationBlockchainID: ethers.constants.HashZero,
                teleporterFee: 0,
                secondaryTeleporterFee: 0
            }
        };

        const instructions = {
            sourceId: 1,
            receiver: wallet.address,
            payableReceiver: false,
            rollbackReceiver: wallet.address,
            rollbackTeleporterFee: 0,
            rollbackGasLimit: 500000,
            hops: [swapHop]
        };

        // 5. Hitung biaya
        spinner.text = chalk.cyan(`[${transactionNum}/${totalTransactions}] Menghitung biaya...`);
        const [fixedFee, baseFee] = await uniV2Cell.calculateFees(instructions, amountIn);
        const totalValue = amountIn.add(fixedFee).add(baseFee);

        // 6. Konfigurasi gas
        const gasPrice = ethers.utils.parseUnits("0.001250001", "gwei");
        const gasLimit = 221474;

        // 7. Eksekusi swap
        spinner.text = chalk.cyan(`[${transactionNum}/${totalTransactions}] Mengirim transaksi...`);
        const tx = await uniV2Cell.initiate(
            ethers.constants.AddressZero,
            amountIn,
            instructions,
            {
                value: totalValue,
                gasPrice: gasPrice,
                gasLimit: gasLimit
            }
        );

        spinner.succeed(chalk.green(`[${transactionNum}/${totalTransactions}] Transaksi berhasil! Hash: ${tx.hash}`));
        
        // Menunggu konfirmasi
        const confirmSpinner = ora({
            text: chalk.yellow(`[${transactionNum}/${totalTransactions}] Menunggu konfirmasi blockchain...`),
            spinner: 'bouncingBar'
        }).start();
        
        const receipt = await tx.wait();
        confirmSpinner.succeed(chalk.green(`[${transactionNum}/${totalTransactions}] Dikonfirmasi di blok: ${receipt.blockNumber}`));
        
        const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
        console.log(chalk.cyan(`[${transactionNum}/${totalTransactions}] Biaya gas: ${ethers.utils.formatEther(gasCost)} KITE`));
        
        return {
            success: true,
            hash: tx.hash,
            block: receipt.blockNumber,
            fee: parseFloat(ethers.utils.formatEther(gasCost))
        };
    } catch (error) {
        spinner.fail(chalk.red(`[${transactionNum}/${totalTransactions}] Transaksi gagal: ${error.message}`));
        return {
            success: false,
            error: error.message
        };
    }
}

// Fungsi utama
async function main() {
    // Tampilkan banner
    showBanner();
    
    // Tanya jumlah transaksi
    const answers = await inquirer.prompt([
        {
            type: 'number',
            name: 'transactionCount',
            message: 'Masukkan jumlah transaksi yang ingin dijalankan:',
            default: 1,
            validate: value => value > 0 ? true : 'Masukkan angka lebih besar dari 0'
        }
    ]);
    
    const transactionCount = answers.transactionCount;
    
    // Setup provider dan wallet
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL, CHAIN_ID);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    console.log(chalk.cyan(`\nWallet: ${wallet.address}`));
    console.log(chalk.cyan(`Jaringan: Kite Testnet (Chain ID ${CHAIN_ID})`));
    console.log(chalk.cyan(`Kontrak UniV2Cell: ${UNIV2CELL_ADDRESS}\n`));
    
    // Load kontrak
    const uniV2Cell = new ethers.Contract(UNIV2CELL_ADDRESS, UNIV2CELL_ABI, wallet);
    
    // Buat progress bar
    const progressBar = new cliProgress.SingleBar({
        format: 'Progress: |' + gradient('magenta', 'cyan')('{bar}') + '| {percentage}% | {value}/{total} Transaksi',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
    });
    
    progressBar.start(transactionCount, 0);
    
    // Jalankan transaksi
    let successCount = 0;
    let totalFee = 0;
    const results = [];
    
    for (let i = 1; i <= transactionCount; i++) {
        const result = await runSwap(wallet, uniV2Cell, i, transactionCount);
        
        if (result.success) {
            successCount++;
            totalFee += result.fee;
            results.push({
                transaction: i,
                status: 'Success',
                hash: result.hash,
                block: result.block,
                fee: result.fee
            });
        } else {
            results.push({
                transaction: i,
                status: 'Failed',
                error: result.error
            });
        }
        
        progressBar.update(i);
    }
    
    progressBar.stop();
    
    // Tampilkan ringkasan
    console.log('\n' + gradient('cyan', 'green')(figlet.textSync('Ringkasan', { font: 'Small' })));
    console.log(chalk.cyan(`Total Transaksi: ${chalk.bold(transactionCount)}`));
    console.log(chalk.green(`Berhasil: ${chalk.bold(successCount)}`));
    console.log(chalk.red(`Gagal: ${chalk.bold(transactionCount - successCount)}`));
    console.log(chalk.yellow(`Total Biaya Gas: ${chalk.bold(totalFee.toFixed(12))} KITE\n`));
    
    // Tampilkan detail transaksi
    console.log(chalk.cyan.bold('Detail Transaksi:'));
    results.forEach(result => {
        if (result.status === 'Success') {
            console.log(chalk.green(`[${result.transaction}] Sukses: ${result.hash}`));
            console.log(chalk.cyan(`   Blok: ${result.block} | Biaya: ${result.fee.toFixed(12)} KITE`));
        } else {
            console.log(chalk.red(`[${result.transaction}] Gagal: ${result.error}`));
        }
    });
    
    // Animasi penutup
    const closingSpinner = ora({
        text: gradient.rainbow('Menutup Tesseract Kite Swap...'),
        spinner: 'hearts'
    }).start();
    
    setTimeout(() => {
        closingSpinner.succeed(gradient.rainbow('Bot swap selesai! Terima kasih telah menggunakan Tesseract Kite Swap by bactiar291'));
        console.log('\n');
    }, 2000);
}

main().catch(error => {
    console.error(chalk.red(`Error utama: ${error.message}`));
    process.exit(1);
});
