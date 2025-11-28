const native = require('./native/dist');

class ZingoLib {
    constructor(uri, chain) {
        this.serveruri = uri;
        this.chain = chain;

        this.syncInterval;
        this.syncStatusInterval;
        this.syncLock = false;
        this.lastWalletBlockHeight;
        this.lastServerBlockHeight;
        this.totalSpendableBalance = 0;
        this.inRefresh = false;
        this.isSending = false;
    }

    async init() {
        return new Promise(async (resolve, reject) => {            
            if(!native.setCryptoDefaultProviderToRing()) {
                reject("Error initializing crypto provider.")
            };
            if (native.walletExists(this.serveruri, this.chain)) {
                try {
                    const wallet = native.initFromDisk(this.serveruri, this.chain);
                    if (wallet && !wallet.toLowerCase().startsWith('error')) {
                        console.log(wallet);
                    }
                }
                catch(err) {
                    console.log(`Error initializing wallet: ${err}`);
                    reject(wallet);
                }
            }
            else {
                console.log("No wallet configured, creating a new one from fresh entropy..");
                try {
                    const res = native.initNew(this.serveruri, this.chain);
                    const seed = await this.getWalletSeed();
                    console.log(`${res}\nPlease save this recovery info:`, seed);
                }
                catch(err) {
                    console.log("Error trying to create a new wallet", seed);
                    reject(err);
                }                                
            }
            this.configure();
            resolve("Ok");
        });             
    }

    restore(seed, birthday) {
        return new Promise((resolve, reject) => {
            if(!native.setCryptoDefaultProviderToRing()) {
                reject("Error initializing crypto provider.")
            };
            if(seed) {            
                console.log("Trying to initialize wallet from seed ...")
                const res = native.initFromSeedPhrase(this.serveruri, seed, birthday, this.chain);
                if(!res.toLowerCase().startsWith('error')) {
                    // const seedJson = JSON.parse(res);
                    console.log(`Seed imported, will sync from height ${birthday}`);
                    resolve(res);
                }
                else {
                    console.log("Error initializing from seed");
                    reject(seed);
                }
            }
        });        
    }

    from_ufvk(ufvk, birthday) {
        return new Promise((resolve, reject) => {
            if(!native.setCryptoDefaultProviderToRing()) {
                reject("Error initializing crypto provider.")
            };
            if(ufvk) {            
                console.log("Trying to initialize wallet from ufvk (watch only) ...")
                const res = native.initFromUfvk(this.serveruri, ufvk, birthday, this.chain);
                if(!res.toLowerCase().startsWith('error')) {
                    const ufvkRes = res;
                    console.log(`ufvk imported, will sync from height ${birthday}`);
                    resolve(ufvkRes);
                }
                else {
                    console.log("Error initializing from ufvk:");
                    reject(res);
                }
            }
        });        
    }

    // async sleep(ms) {
    //     return new Promise((resolve, reject) => {
    //         setTimeout(() => resolve(), ms);
    //     });
    // }

    configure() {
        try {
            this.fetchServerHeight();
            this.fetchWalletHeight();

            // const task = native.saveWalletTask();
            // console.log(task);

            // Get confirmed balance
            const balance = this.fetchWalletBalance();
            if(balance) {
                const combinedBalance = balance.confirmed_orchard_balance + balance.confirmed_sapling_balance + balance.confirmed_transparent_balance;
                this.totalSpendableBalance = Number(combinedBalance / 10**8).toFixed(8);
            }           
                         
            // Do initial sync
            this.doRefresh(false);

            // Refresh wallet every 75 seconds
            this.syncInterval = setInterval(() => {
                this.doRefresh(false);
            }, 75 * 1000);

            process.on('SIGINT', () => {
                this.deinitialize();
                process.exit();
            });
        }
        catch (e) {
            console.log("Couldn't configure the wallet", e);
            return;
        }
    }

    pauseSyncProcess() {
        try {
            const res = native.pauseSync();
            console.log(res);
        }
        catch(err) {
            console.log(err);
        }
    }

    stopSyncProcess() {
        try {
            const res = native.stopSync();
            console.log(res);
        }
        catch(err) {
            console.log(err);
        }
    }

    doSaveWallet() {
        try {
            const res = native.saveWallet();
            console.log(res)
        } catch (error) {
            console.log(`Critical Error save wallet ${error}`);
        }
    }
    
    doSyncStatus() {
        try {
            const syncStatusStr = native.statusSync();
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

    doSyncPoll() {
        try {
            const syncPollStr = native.pollSync();
            if (syncPollStr) {
                if (syncPollStr.toLowerCase().startsWith('error')) {
                    console.log(`Error sync poll ${syncPollStr}`);
                    throw(syncPollStr);
                }
            } else {
                console.log('Internal Error sync poll');
                throw('Error: Internal RPC Error: sync poll');
            }

            return syncPollStr;
        } catch (error) {
            console.log(`Critical Error sync poll ${error}`);
            return `Error: ${error}`;
        }
    }

    doRefresh(fullRefresh) {
        if (this.syncStatusInterval) {            
            console.log(`Already have a sync process launched.`);
            return;
        }

        if (this.isSending) {
            console.log("Wallet is sending, will sync after send is done.");
            return;
        }

        if(this.syncLock) {
            console.log("Wallet is busy, will sync after heavy operation is done.");
            return;
        }

        // await this.fetchWalletHeight();
        this.fetchServerHeight();

        if (this.lastWalletBlockHeight < this.lastServerBlockHeight || fullRefresh) {
        // if (this.lastServerBlockHeight - this.lastWalletBlockHeight >= 3 || fullRefresh) {
            this.inRefresh = true;

            console.log(`Refresing wallet: ${this.lastServerBlockHeight - this.lastWalletBlockHeight} new blocks.`);

            try {
                let res = native.runSync();
                if(res) {
                    console.log(res)
                    if(res.toLowerCase().startsWith("error")) {
                        throw(res);                        
                    }

                    this.syncStatusInterval = setInterval(() => {
                        const ssStr = this.doSyncStatus();
                        const ssJson = JSON.parse(ssStr);

                        this.fetchWalletHeight();

                        const spStr = this.doSyncPoll();
                        
                        if(spStr == "Sync task is not complete.") {
                            console.log(spStr);
                            console.log(`Wallet height: ${this.lastWalletBlockHeight} | chain_tip: ${this.lastServerBlockHeight}`);                        
                            console.log(`Sync progress: ${ssJson.percentage_total_blocks_scanned.toFixed(2)}`);
                        }
                        else if(spStr == "Sync task has not been launched." ) {                            
                            console.log(spStr);
                            clearInterval(this.syncStatusInterval);
                            this.syncStatusInterval = undefined;
                            this.inRefresh = false;  
                        }
                        else if(ssJson && ssJson.percentage_total_blocks_scanned >= 100) {
                            try {
                                // const spStr = await this.doSyncPoll();
                                // console.log(spStr);
                                // this.stopSyncProcess();
                                const spJson = JSON.parse(spStr);
                                console.log(`sync_complete { "blocks_scanned": ${spJson.sync_complete?.blocks_scanned} }\n`);
                                
                                this.fetchWalletHeight();
                                this.fetchServerHeight();
                                this.doSaveWallet();

                                this.totalSpendableBalance = this.fetchTotalSpendableBalance();
                                                                
                                clearInterval(this.syncStatusInterval);
                                this.syncStatusInterval = undefined;
                                this.inRefresh = false;                                                                
                            }
                            catch(e) { 
                                clearInterval(this.syncStatusInterval);
                                this.syncStatusInterval = undefined;
                                this.inRefresh = false;  
                            }                            
                        }
                    }, 4 * 1000);
                }
                else {
                    throw("Critical Error run_sync");
                }                
            }
            catch(err) {
                clearInterval(this.syncStatusInterval);
                this.syncStatusInterval = undefined;
                this.inRefresh = false;
                console.log(err);
                return;
            }  
        }
        else {
            console.log(`No new blocks to sync. Wallet height: ${this.lastWalletBlockHeight} | Server height: ${this.lastServerBlockHeight}`);
        }
    }

    doRescan() {
        console.log("Triggering a wallet rescan ...");
        try {
            const res = native.runRescan();        
            if(res) {
                console.log(res);
            }
            else if(res.toLowerCase().startsWith("error")) {
                throw(res);
            }
            else {
                throw("Internal Error rescan");
            }
        }
        catch(e) {
            console.log(e);
        }                
    }

    fetchServerHeight() {
        try {
            const heightStr = native.getLatestBlockServer(this.serveruri);
            if (heightStr) {
                if (heightStr.toLowerCase().startsWith('error')) {
                    console.log(`Error server height ${heightStr}`);
                    return;
                }
            } else {
                console.log('Internal Error server height');
                return;
            }
            
            this.lastServerBlockHeight = heightStr;
        }
        catch(err) {
            console.log(`Critical Error server height ${err}`);
            return -1;
        }   
        
        return this.lastServerBlockHeight;
    }

    fetchWalletHeight() {
        try {
            const heightStr = native.getLatestBlockWallet();
            if (heightStr) {                    
                const heightJson = JSON.parse(heightStr);
                this.lastWalletBlockHeight = heightJson.height;
            }
            else {
                throw("Internal Error wallet height");
            }
        }
        catch(err) {
            console.log(`Critical Error wallet height ${err}`);
            return -1;
        }   
        
        return this.lastWalletBlockHeight;
    }   

    fetchTotalSpendableBalance() {
        try {
            const bal = native.getSpendableBalanceTotal();
            // const bal = this.fetchWalletBalance();
            if (bal) {
                return Number(bal / 10**8).toFixed(8);
            }
            else {
                throw(`Internal Error wallet balance ${bal}`);
            }
        }
        catch(err) {
            console.log(`Critical Error wallet balance ${err}`);
            return -1;
        } 
    }

    fetchWalletBalance() {
        try {
            const bal = native.getBalance();
            if (bal) {                    
                if(bal.toLowerCase().startsWith("error")) {
                    throw("Internal Error wallet balance");
                }
                const balJson = JSON.parse(bal);
                return balJson;
            }
            else {
                throw("Internal Error wallet balance");
            }
        }
        catch(err) {
            console.log(`Critical Error wallet balance ${err}`);
            return {};
        } 
    }

    fetchNotes() {
        try {
            const notesStr = native.getNotes(false);
            if (notesStr) {
                if (notesStr.toLowerCase().startsWith('error')) {
                    throw(`Error wallet notes ${notesStr}`);                    
                }
            } else {
                throw('Internal Error wallet notes');                
            }
            const notesJSON = JSON.parse(notesStr);
            return notesJSON;
        }
        catch (error) {
            console.log(`Critical Error wallet height ${error}`);
            return;
        }
    }

    fetchAllAddresses() {
        try {
            const addrStr = native.getUnifiedAddresses();
            
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

    // async getAddressesWithBalance() {
    //     const addrList = await this.fetchAllAddresses();
    //     const ab = [];
    //     if (addrList) {
    //         const notes = await this.fetchNotes();
    //         addrList.forEach((addr) => {                
    //             // Sum of unspent UTXOs    
    //             const utxoValue = notes.utxos
    //                 .filter((n) => n.address == addr.address)
    //                 .reduce((acc, curr) => acc + curr.value, 0);

    //             // Sum of sapling notes   
    //             const saplingValue = notes.unspent_sapling_notes
    //                 .filter((n) => n.address == addr.address)
    //                 .reduce((acc, curr) => acc + curr.value, 0);

    //             // Sum of orchard notes
    //             const orchardValue = notes.unspent_orchard_notes
    //                 .filter((n) => n.address == addr.address)
    //                 .reduce((acc, curr) => acc + curr.value, 0);

    //             const totalValue = (utxoValue + saplingValue + orchardValue);
    //             if(totalValue > 0) {
    //                 ab.push({
    //                     address: addr.address,
    //                     receivers: addr.receivers,
    //                     balance: totalValue
    //                 });
    //             }
    //         });
    //     }

    //     return ab;
    // }

    // async getAddressAndValueFromTx(tx) {
    //     const allNotes = await this.fetchNotes();
    //     let notes = [];
    //     const txid = tx.txid.toString();
    //     // Try orchard notes
    //     notes = allNotes.unspent_orchard_notes.filter((n) => n.created_in_txid == txid);
    //     if(notes.length == 0) notes = allNotes.pending_orchard_notes.filter((n) => n.created_in_txid == txid);
    
    //     // Try sapling notes
    //     if(notes.length == 0) notes = allNotes.unspent_sapling_notes.filter((n) => n.created_in_txid == txid);
    //     if(notes.length == 0) notes = allNotes.pending_sapling_notes.filter((n) => n.created_in_txid == txid);

    //     // Try transparent utxos
    //     if(notes.length == 0) notes = allNotes.utxos.filter((n) => n.created_in_txid == txid);
    //     if(notes.length == 0) notes = allNotes.pending_utxos.filter((n) => n.created_in_txid == txid);
        
    //     const addrAndValue = notes.map((el) => {
    //         return {
    //             address: el.address,
    //             value: el.value
    //         }
    //     });
    //     return addrAndValue;
    // }

    shieldTransparent() {
        console.log('Trying to shield transparent funds ...')
        try {
            const resStr = native.quickShield();
            const resJson = JSON.parse(resStr);
            if(resJson.error) {
                throw(`Internal Error shielding: ${resJson.error}`);
            }

            console.log("Succesfully shielded transparent funds.");
            console.log(resJson.txids);
        }
        catch(err) {
            console.log(err);
        }        
    }

    async sendTransaction(sendJson) {
        return new Promise((resolve, reject) => {
            native.send(sendJson).then(fee => {
                console.log(fee);
                const txid = native.confirm();
                resolve(txid);
            }).catch((err) => { 
                console.log(err);
                reject(err);
            });
        });
    }

    resendTransaction(txid) {
        try {
            const res = native.resendTransaction(txid);
            console.log(res);
            this.doSaveWallet();
        }
        catch(err) {
            console.log(`Resend transaction error: ${err}`);            
        }
    }

    removeTransaction(txid) {
        try {
            const res = native.removeTransaction(txid);            
            console.log(res);
            this.doSaveWallet();
        }
        catch(err) {
            console.log(`Remove transaction error: ${err}`);            
        }
    }

    async getTransactions() {
         const txns = await this.getTransactionsPromise();
         return txns;
    }

    getTransactionsPromise() {
        this.syncLock = true;
        return new Promise((resolve, reject) => {
            native.getValueTransfersAsync().then((txnsStr) => {
                if (txnsStr) {
                    if (txnsStr.toLowerCase().startsWith('error')) {
                        console.log(`Error wallet transactions ${txnsStr}`);
                        throw(txnsStr);
                    }
                } else {
                    // console.log('Internal Error wallet transactions');
                    throw("Internal Error wallet transactions");
                }
                const txnsJSON = JSON.parse(txnsStr);
                this.syncLock = false;
                resolve(txnsJSON);
            }).catch((error) => {
                // console.log(`Critical Error wallet transactions ${error}`);
                this.syncLock = false;
                reject(error);
            });
        });        
    }

    fetchLastTxId() {        
        try {
            const txid = native.lastTxid();
        
            if(txid && !txid.toLowerCase().startsWith('error')) {
                return txid;
            }
            else {
                throw(txid);                
            }
        }
        catch(err) {
            console.log(`Last txid error: ${err}`);
            return -1;
        }
    }

    getWalletSeed() {
        try {
            const seedStr = native.getSeed();
            if(seedStr) {
                const seedJson = JSON.parse(seedStr);
                return seedJson;
            }
            else return "Error: Couldn't get wallet seed.";
        }
        catch(err) {
            console.log(`Critical Error getting wallet seed: ${err}`);
        }        
    }

    getWalletUfvk() {
        try {
            const ufvkStr = native.getUfvk();
            if(ufvkStr) {
                const ufvkJson = JSON.parse(ufvkStr);
                return ufvkJson;
            }
            else return "Error: Couldn't get wallet ufvk.";
        }
        catch(err) {
            console.log(`Critical Error getting wallet ufvk: ${err}`);
        } 
    }

    parseAddress(addr) {
        try {
            const addrStr = native.parseAddress(addr);
            if (addrStr) {
                const addrJson = JSON.parse(addrStr);
                return addrJson;               
            } else {
                throw('Internal Error parsing address');                
            }            
        }
        catch (error) {
            console.log(`Critical Error parsing address ${error}`);
            return;
        }
    }

    async createNewAddress() {
        try {
            const addrStr = native.createNewUnifiedAddress('oz');
            if (addrStr.toLowerCase().startsWith('error')) {
                throw(`Error creating address ${addrStr}`);
            }
            const addrJson = JSON.parse(addrStr);
            return addrJson;
        }
        catch(err) {
            console.log(err);
            return err;
        }
    }

    deinitialize() {
        console.log("Safely shutting down zingolib ... ");
        // this.stopSyncProcess();
        this.doSaveWallet();
        process.exit();
    }   
}

module.exports = ZingoLib;