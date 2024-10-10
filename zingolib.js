const native = require('./native.node');

class ZingoLib {
    constructor(uri, chain) {
        this.serveruri = uri;
        this.chain = chain;

        this.syncInterval;
        this.syncStatusInterval;
        this.lastWalletBlockHeight;
        this.lastServerBlockHeight;
        this.inRefresh = false;
        this.isSending = false;
    }

    async init() {
        return new Promise(async (resolve, reject) => {            
            if (native.zingolib_wallet_exists('https://zec.rocks:443', 'main')) {
                const wallet = native.zingolib_init_from_b64(this.serveruri, 'main');
                if (wallet && !wallet.toLowerCase().startsWith('error')) {
                    console.log("Initializing existing wallet.");
                }
                else {
                    console.log("Error initializing wallet");
                    reject(wallet);
                }
            }
            else {
                console.log("No wallet configured, creating a new one.");
                const seed = native.zingolib_init_new(this.serveruri, 'main', true);
                if (seed && !seed.toLowerCase().startsWith('error')) {
                    console.log('Created new wallet, please save the seed:', seed);
                }
                else {
                    console.log("Error trying to create a new wallet", seed);
                    reject(seed);
                }
            }
            await this.configure();
            resolve("Ok");
        });
    }

    async restore(seed, birthday) {
        return new Promise((resolve, reject) => {
            if(seed) {            
                console.log("Trying to initialize wallet from seed ...")
                const res = native.zingolib_init_from_seed(this.serveruri, seed, birthday, this.chain);
                if(!res.toLowerCase().startsWith('error')) {
                    const seedJson = JSON.parse(res);
                    console.log(`Seed imported, will sync from height ${birthday}`);
                    resolve(seedJson);
                }
                else {
                    console.log("Error initializing from seed");
                    reject(seed);
                }
            }
        });        
    }

    async sleep(ms) {
        return new Promise((resolve, reject) => {
            setTimeout(() => resolve(), ms);
        });
    }

    async configure() {
        try {
            await this.stopSyncProcess();
            // await this.fetchInfoAndServerHeight();

            // Save wallet
            // const res = native.saveWallet();
            // if (!res || res.toLowerCase().startsWith('error')) {
            //     console.log("Error saving wallet");
            // }

            // Refresh wallet every 30 seconds
            this.syncInterval = setInterval(() => {
                this.doRefresh(false);
            }, 30 * 1000);
        }
        catch (e) {
            console.log("Couldn't configure the wallet", e);
            return;
        }
    }

    async stopSyncProcess() {
        let res = await this.doSyncStatus();
        let ss = JSON.parse(res);

        while (ss.in_progress) {
            await this.sleep(300);

            this.setInterruptSyncAfterBatch(true);
            console.log('stop sync process. in progress', ss.in_progress);

            res = await this.doSyncStatus();
            ss = JSON.parse(res);
        }

        console.log('stop sync process. STOPPED');
        await this.setInterruptSyncAfterBatch('false');
    }

    async doSyncStatus() {
        try {
            const syncStatusStr = await native.zingolib_execute_async('syncstatus', '');
            if (syncStatusStr) {
                if (syncStatusStr.toLowerCase().startsWith('error')) {
                    console.log(`Error sync status ${syncStatusStr}`);
                    return syncStatusStr;
                }
            } else {
                console.log('Internal Error sync status');
                return 'Error: Internal RPC Error: sync status';
            }

            return syncStatusStr;
        } catch (error) {
            console.log(`Critical Error sync status ${error}`);
            return `Error: ${error}`;
        }
    }

    async setInterruptSyncAfterBatch(value) {
        try {
            const resultStr = await native.zingolib_execute_spawn('interrupt_sync_after_batch', value);

            if (resultStr) {
                if (resultStr.toLowerCase().startsWith('error')) {
                    console.log(`Error setting interrupt_sync_after_batch ${resultStr}`);
                }
            } else {
                console.log('Internal Error setting interrupt_sync_after_batch');
            }
        } catch (error) {
            console.log(`Critical Error setting interrupt_sync_after_batch ${error}`);
        }
    }

    async doRefresh(fullRefresh) {
        if (this.syncStatusInterval) {
            console.log("Already have a sync process launched.");
            return;
        }

        if (this.isSending) {
            console.log("Wallet is sending, will sync after send is done.");
            return;
        }

        this.fetchWalletHeight();
        this.fetchInfoAndServerHeight();

        if (this.lastWalletBlockHeight < this.lastServerBlockHeight || fullRefresh) {
            this.inRefresh = true;

            console.log(`Refresing wallet: ${this.lastServerBlockHeight - this.lastWalletBlockHeight} new blocks.`);

            native.zingolib_execute_spawn('sync', '');

            this.syncStatusInterval = setInterval(async () => {
                this.fetchWalletHeight();
                this.fetchInfoAndServerHeight();

                if (this.lastWalletBlockHeight >= this.lastServerBlockHeight) {
                    clearInterval(this.syncStatusInterval);
                    this.syncStatusInterval = undefined;

                    console.log("Wallet is up to date!");

                    this.lastBlockHeight = this.lastServerBlockHeight;
                    this.inRefresh = false;

                    // await native.saveWallet();
                }
                else {
                    const ssStr = await this.doSyncStatus();
                    const ss = JSON.parse(ssStr);
                    if (!ss.in_progress) {
                        clearInterval(this.syncStatusInterval);
                        this.syncStatusInterval = undefined;

                        console.log("Wallet is up to date!");

                        this.lastBlockHeight = this.lastServerBlockHeight;
                        this.inRefresh = false;

                        // await native.saveWallet();
                    }
                }
            }, 2 * 1000);
        }
        else {
            console.log(`No new blocks to sync.`);
        }
    }

    async fetchInfoAndServerHeight() {
        const res = await native.zingolib_execute_async('info', '');
        if (res && !res.toLowerCase().startsWith('error')) {
            const infoJson = JSON.parse(res);
            this.infoObject = infoJson;
            this.lastServerBlockHeight = infoJson.latest_block_height;
        }
    }

    async fetchWalletHeight() {
        try {
            const heightStr = await native.zingolib_execute_async('height', '');
            if (heightStr) {
                if (heightStr.toLowerCase().startsWith('error')) {
                    console.log(`Error wallet height ${heightStr}`);
                    return;
                }
            } else {
                console.log('Internal Error wallet height');
                return;
            }
            const heightJSON = JSON.parse(heightStr);
            this.lastWalletBlockHeight = heightJSON.height;
        }
        catch (error) {
            console.log(`Critical Error wallet height ${error}`);
            return;
        }
    }

    async fetchTotalBalance() {
        try {
            const balStr = await native.zingolib_execute_async('balance', '');
            if (balStr) {
                if (balStr.toLowerCase().startsWith('error')) {
                    console.log(`Error wallet balance ${balStr}`);
                    return 0;
                }
            } else {
                console.log('Internal Error wallet balance');
                return 0;
            }
            const balJson = JSON.parse(balStr);
            const totalBal = (balJson.spendable_sapling_balance + balJson.spendable_orchard_balance + balJson.transparent_balance) / 10**8;
            return totalBal;
        }
        catch (error) {
            console.log(`Critical Error wallet balance ${error}`);
            return;
        }
    }

    async fetchNotes() {
        try {
            const notesStr = await native.zingolib_execute_async('notes', '');
            if (notesStr) {
                if (notesStr.toLowerCase().startsWith('error')) {
                    console.log(`Error wallet notes ${notesStr}`);
                    return;
                }
            } else {
                console.log('Internal Error wallet notes');
                return;
            }
            const notesJSON = JSON.parse(notesStr);
            return notesJSON;
        }
        catch (error) {
            console.log(`Critical Error wallet height ${error}`);
            return;
        }
    }

    async fetchAllAddresses() {
        try {
            const addrStr = await native.zingolib_execute_async('addresses', '');
            
            if (addrStr) {
                if (addrStr.toLowerCase().startsWith('error')) {
                    console.log(`Error getting addresses ${addrStr}`);
                    return;
                }
            } else {
                console.log('Internal Error getting addresses');
                return;
            }
            const addrJSON = JSON.parse(addrStr);
            return addrJSON;
        }
        catch (error) {
            console.log(`Critical Error getting addresses ${error}`);
            return;
        }
    }

    async getAddressesWithBalance() {
        const addrList = await this.fetchAllAddresses();
        const ab = [];
        if (addrList) {
            const notes = await this.fetchNotes();
            addrList.forEach((addr) => {                
                // Sum of unspent UTXOs    
                const utxoValue = notes.utxos
                    .filter((n) => n.address == addr.address)
                    .reduce((acc, curr) => acc + curr.value, 0);

                // Sum of sapling notes   
                const saplingValue = notes.pending_sapling_notes
                    .filter((n) => n.address == addr.address)
                    .reduce((acc, curr) => acc + curr.value, 0);

                // Sum of orchard notes
                const orchardValue = notes.unspent_orchard_notes
                    .filter((n) => n.address == addr.address)
                    .reduce((acc, curr) => acc + curr.value, 0);

                const totalValue = (utxoValue + saplingValue + orchardValue);
                if(totalValue > 0) {
                    ab.push({
                        address: addr.address,
                        receivers: addr.receivers,
                        balance: totalValue
                    });
                }
            });
        }

        return ab;
    }

    async sendTransaction(sendJson) {
         // First, get the previous send progress id, so we know which ID to track
        const prevProgressStr = await native.zingolib_execute_async("sendprogress", "");
        const prevProgressJSON = JSON.parse(prevProgressStr);
        const prevSendId = prevProgressJSON.id;
        let sendTxids = '';
        
        this.isSending = true;

        // Propose a tx
        try {
            console.log(`Sending ${JSON.stringify(sendJson)}`);
            const resp = await native.zingolib_execute_async("send", JSON.stringify(sendJson));            
            console.log(`End Sending, response: ${resp}`); 
        } 
        catch(err) {
            console.log(`Error sending Tx: ${err}`);
            this.isSending = false;
            throw err;
        }

        // Confirm the tx ...
        try {
            console.log('Confirming');
            const resp = await native.zingolib_execute_async("confirm", "");
            console.log(`End Confirming, response: ${resp}`);
            if (resp.toLowerCase().startsWith('error')) {
                console.log(`Error confirming Tx: ${resp}`);
                throw Error(resp);  
            } 
            else {
                const respJSON = JSON.parse(resp);
                if (respJSON.error) {
                    console.log(`Error confirming Tx: ${respJSON.error}`);
                    throw Error(respJSON.error);
                } 
                else if (respJSON.txids) {
                    sendTxids = respJSON.txids.join(', ');
                } 
                else {
                    console.log(`Error confirming: no error, no txids `);
                    throw Error('Error confirming: no error, no txids');
                }
            }
        } catch (err) {
            console.log(`Error confirming Tx: ${err}`);
            throw err;
        }
        
        // Return the promise, resolve with txid
        return new Promise((resolve, reject) => {
            const intervalID = setInterval(async () => {
                const progressStr = await native.zingolib_execute_async("sendprogress", "");
                const progressJSON = JSON.parse(progressStr);

                if (progressJSON.id === prevSendId  && !sendTxids) {
                    // Still not started, so wait for more time
                    return;
                }

                if (!progressJSON.txid && !progressJSON.error  && !sendTxids) {
                    // Still processing
                    return;
                }

                // Finished processing
                clearInterval(intervalID);
                this.isSending = false;

                if (progressJSON.txid) {
                    // And refresh data (full refresh)
                    this.doRefresh(true);
            
                    resolve(progressJSON.txid);
                }
        
                if (progressJSON.error) {
                    reject(progressJSON.error);
                }

                if (sendTxids) {
                    // And refresh data (full refresh)
                    this.doRefresh(true);
          
                    resolve(sendTxids);
                  }

            }, 2 * 1000); // Every two seconds

        });
    }

    getTransactions() {
        try {
            const txnsStr = native.zingolib_get_value_transfers();
            if (txnsStr) {
                if (txnsStr.toLowerCase().startsWith('error')) {
                    console.log(`Error wallet transactions ${txnsStr}`);
                    return;
                }
            } else {
                console.log('Internal Error wallet transactions');
                return;
            }
            const txnsJSON = JSON.parse(txnsStr);
            return txnsJSON;
        }
        catch (error) {
            console.log(`Critical Error wallet transactions ${error}`);
            return;
        }
    }

    getTransactionsSummaries() {
        try {
            const txnsStr = native.zingolib_get_transaction_summaries();
            if (txnsStr) {
                if (txnsStr.toLowerCase().startsWith('error')) {
                    console.log(`Error wallet transactions summaries ${txnsStr}`);
                    return;
                }
            } else {
                console.log('Internal Error wallet transactions summaries');
                return;
            }
            const txnsJSON = JSON.parse(txnsStr);
            return txnsJSON;
        }
        catch (error) {
            console.log(`Critical Error wallet transactions summaries ${error}`);
            return;
        }
    }

    async fetchLastTxId() {
        // const txList = this.getTransactions();
        // if(txList) {
        //     return txList.value_transfers[txList.value_transfers.length - 1].txid;
        // }
        // else return -1;
        const txList = await native.zingolib_get_transaction_summaries();
        const txListJson = JSON.parse(txList);
        if(txListJson && txListJson.length > 0) {
            // console.log(txListJson.transaction_summaries)
            return txListJson.transaction_summaries[txListJson.transaction_summaries.length - 1].txid;
        }
        else return -1;
    }

    async getDefaultFee() {        
        const feeStr = await native.zingolib_execute_async('defaultfee', '');
        if(feeStr) {
            const feeJson = JSON.parse(feeStr);
            return parseFloat((feeJson.defaultfee / 10**8).toFixed(8));
        }
        else return 10000; // Fail safe
    }

    async getWalletSeed() {
        const seedStr = await native.zingolib_execute_async('seed', '');
        if(seedStr) {
            const seedJson = JSON.parse(seedStr);
            return seedJson;
        }
        else return "Error: Couldn't get wallet seed.";
    }

    async getWalletUfvk() {
        const ufvkStr = await native.zingolib_execute_async('exportufvk', '');
        if(ufvkStr) {
            const ufvkJson = JSON.parse(ufvkStr);
            return ufvkJson;
        }
        else return "Error: Couldn't get wallet ufvk.";
    }

    async parseAddress(addr) {
        try {
            const addrStr = await native.zingolib_execute_async('parse_address', addr);
            if (addrStr) {
                if (addrStr.toLowerCase().startsWith('error')) {
                    console.log(`Error parsing address ${addrStr}`);
                    return;
                }
            } else {
                console.log('Internal Error parsing address');
                return;
            }
            const addrJSON = JSON.parse(addrStr);
            return addrJSON;
        }
        catch (error) {
            console.log(`Critical Error parsing address ${error}`);
            return;
        }
    }

    async deinitialize() {
        console.log("Safely shutting down zingolib ... ");
        await native.zingolib_execute_async('quit', '');
        process.exit();
    }
}

module.exports = ZingoLib;