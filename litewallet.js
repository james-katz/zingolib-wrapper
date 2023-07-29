const native = require("./native.node");
const axios = require('axios');

const { TxDetail, Transaction, TotalBalance, Address, AddressBalance, WalletSettings, Info } = require('./utils/classes');

class LiteWallet {
    constructor(url) {
        this.url = url;

        this.lastSyncId;
        this.lastBlockHeight;
        this.lastTxId;
        this.transactionsList;

        this.walletSettings;

        this.lastZecPrice;
        this.lastPriceFetch;
        
        this.refreshTimerId;
        this.updateTimerId;
        this.updateDataLock = false;
    }

    init() {
        return new Promise((resolve, reject) => {
            if(!native.zingolib_wallet_exists(this.url)) {                
                console.log('Wallet not configured, creating new one!');
                const res = native.zingolib_initialize_new(this.url);
                if(res.toString().toLowerCase().startsWith('error')) {
                    reject("Error: Couldn't create a wallet");
                }
                else {
                    const seed = JSON.parse(res).seed;
                    console.log("Wallet created! Please save the wallet seed:\n" + seed);                    
                }
            }
            
            let res = native.zingolib_initialize_existing(this.url);            
            if(res !== 'OK') {
                reject('Something went wrong while initializing the wallet. \n'+ res + '\nQuitting ...');
                return;
            }
            native.zingolib_execute('sync', '');
            console.log('Starting wallet synchronization ...');

            this.lastSyncId = JSON.parse(native.zingolib_execute('syncstatus','')).sync_id;

            const syncPoller = setInterval(async () => {
                var syncStatus = JSON.parse(native.zingolib_execute('syncstatus', ''));
                if(!syncStatus.in_progress && syncStatus.sync_id > this.lastSyncId) {
                    clearInterval(syncPoller);
                    this.lastBlockHeight = await this.fetchLatestBlockHeight();
                    this.lastTxId = this.fetchLastTxId();
                    native.zingolib_execute('save','');

                    this.fetchTandZTransactions(this.lastBlockHeight);
                    
                    this.doRefreshAndUpdateData();
                    resolve('OK');
                }                    
            }, 3 * 1000);
            
        });
    }

    doRefreshAndUpdateData() {
        if(!this.refreshTimerId) {
            this.refreshTimerId = setInterval(() => {
                this.refresh();
            }, 60 * 1000); // refresh wallet every 60 seconds
        }

        if(!this.updateTimerId) {
            this.updateTimerId = setInterval(() => {
                this.updateData();
            }, 3 * 1000); // update data every 3 seconds
        }
    }

    createNewAddress(type) {
        const ua = JSON.parse(native.zingolib_execute('new', type));                
        if(ua.error) return ua.error; // maybe return new Address()     ?

        const addrDetail = this.fetchAllAddresses().filter((addr) => addr.address === ua[0]);
        
        const addr = new Address(addrDetail[0].address, addrDetail[0].receivers);
        return addr;
    }

    fetchTandZTransactions(latestBlockHeight) {    
        const list = this.fetchTxList();
        
        let txList = list.map((tx) => {
            const transaction = new Transaction();
            const type = tx.outgoing_metadata ? "sent" : "receive";

            transaction.address = type === 'sent' ? (tx.outgoing_metadata.length > 0 ? tx.outgoing_metadata[0].address : '') : tx.address;
            transaction.type = type;
            transaction.amount = tx.amount / 10 ** 8;
            transaction.confirmations = tx.unconfirmed ? 0 : latestBlockHeight - tx.block_height + 1;
            transaction.txid = tx.txid;
            transaction.zecPrice = tx.zec_price;
            transaction.time = tx.datetime;
            transaction.position = tx.position;

            if(tx.outgoing_metadata) {
                const dts = tx.outgoing_metadata.map((o) => {
                    const detail = new TxDetail();
                    detail.address = o.address;
                    detail.amount = (o.value / 10 ** 8).toFixed(8);
                    detail.memo = o.memo;
          
                    return detail;
                });
                transaction.detailedTxns = this.combineTxDetails(dts);
            }
            else {
                transaction.detailedTxns = [ new TxDetail() ];
                transaction.detailedTxns[0].address = tx.address;
                transaction.detailedTxns[0].amount = (tx.amount / 10 ** 8).toFixed(8);
                transaction.detailedTxns[0].memo = tx.memo;
            }

            return transaction;
        });
        
        // If you send yourself transactions, the underlying SDK doesn't handle it very well, so
        // we supress these in the UI to make things a bit clearer.
        txList = txList.filter((tx) => !(tx.type === "sent" && tx.amount < 0 && tx.detailedTxns.length === 0));

        // We need to group transactions that have the same (txid and send/recive), for multi-part memos
        const m = new Map();
        txList.forEach((tx) => {
            const key = tx.txid + tx.type;
            const coll = m.get(key);
            if (!coll) {
                m.set(key, [tx]);
            } else {
                coll.push(tx);
            }
        });

        let combinedTxList = [];
        m.forEach((txns) => {
            // Get all the txdetails and merge them
        
            // Clone the first tx into a new one            
            const combinedTx = Object.assign({}, txns[0]);
            combinedTx.detailedTxns = this.combineTxDetails(txns.flatMap((tx) => tx.detailedTxns));
        
            combinedTxList.push(combinedTx);
        });
        
        // Sort the list by confirmations
        combinedTxList.sort((t1, t2) => t1.confirmations - t2.confirmations);

        this.transactionsList = combinedTxList;
        return this.transactionsList;
    }

    combineTxDetails(txdetails) {
        // First, group by outgoing address.
        const m = new Map();
        txdetails.forEach((i) => {
            const coll = m.get(i.address);
            if (!coll) {
                m.set(i.address, [i]);
            } else {
                coll.push(i);
            }
        });

        // Reduce the groups to a single TxDetail, combining memos and summing amounts
        let reducedDetailedTxns = [];
        m.forEach((txns, toaddr) => {
            const totalAmount = txns.reduce((p, td) => p + parseFloat(td.amount), 0);

            const memos = txns
            .filter((i) => i.memo)
            .map((i) => {
                const rex = /\((\d+)\/(\d+)\)((.|[\r\n])*)/;
                const tags = i.memo?.match(rex);
                if (tags && tags.length >= 4) {
                    return { num: parseInt(tags[1], 10), memo: tags[3] };
                }

            // Just return as is
            return { num: 0, memo: i.memo };
            })
            .sort((a, b) => a.num - b.num)
            .map((a) => a.memo);

            const detail = new TxDetail();
            detail.address = toaddr;
            detail.amount = totalAmount.toFixed(8);
            detail.memo = memos.length > 0 ? memos.join("") : null;

            reducedDetailedTxns.push(detail);
        });

        return reducedDetailedTxns;
    }

    async updateData() {
        if(this.updateDataLock) return;

        this.updateDataLock = true;
        
        const latestTxId = this.fetchLastTxId();

        if(this.lastTxId !== latestTxId) {
            this.lastBlockHeight = await this.fetchLatestBlockHeight();
            this.lastTxId = latestTxId;        
            
            this.fetchTandZTransactions(this.lastBlockHeight);
        }

        this.updateDataLock = false;
    }

    async refresh(fullRefresh) {       
        const latestBlockHeight = await this.fetchLatestBlockHeight();
        
        if(!this.lastBlockHeight || this.lastBlockHeight < latestBlockHeight || fullRefresh) {
            console.log('Refreshing wallet: ' + (latestBlockHeight - this.lastBlockHeight) + ' new blocks.');
            this.updateDataLock = true;
            native.zingolib_execute('sync', '');
            let retryCount = 0;
            const syncPoller = setInterval(async () => {
                const walletHeight = this.fetchWalletHeight();
                retryCount ++;

                if(retryCount > 30 || walletHeight >= latestBlockHeight) {                    
                    clearInterval(syncPoller);
                    console.log('Wallet is up to date!');

                    this.fetchTandZTransactions(this.lastBlockHeight);

                    this.lastBlockHeight = latestBlockHeight;

                    native.zingolib_execute('save','');
                    this.updateDataLock = false;
                }                
            }, 1000);
        }
        else console.log('no new blocks');
    }

    async sendTransaction(sendJson) {        
        // First, get the previous send progress id, so we know which ID to track
        const prevProgress = this.getSendProgress();
        const prevSendId = prevProgress.id;  
      
        try {
            await native.zingolib_execute("send", JSON.stringify(sendJson));
        }
        catch(err) {
            console.log(err);
            throw err;
        }

        // The send command is async, so we need to poll to get the status
        const sendTxPromise = new Promise((resolve, reject) => {
            const intervalID = setInterval(() => {
                const progress = this.getSendProgress();
                if(progress.id === prevSendId) {
                    // Still not started, so wait for more time
                    console.log('waiting')
                    return;
                }

                if (!progress.txid && !progress.error) {
                    // Still processing                   
                    return;
                }

                // Finished processing
                clearInterval(intervalID);

                if(progress.txid) {
                    // And refresh data (full refresh)
                    this.refresh(true);
                    resolve(progress.txid);
                }

                if(progress.error) {
                    reject(progress.error);
                }
            }, 2 * 1000) // Every 2 seconds
        });

        return sendTxPromise;
    }

    async getInfoObject() {
        const infostr = native.zingolib_execute("info", "");
        try {
            const infoJSON = JSON.parse(infostr);
            
            const info = new Info();
            info.testnet = infoJSON.chain_name === "test";
            info.latestBlock = infoJSON.latest_block_height;
            info.connections = 1;
            info.version = `${infoJSON.vendor}/${infoJSON.git_commit.substring(0, 6)}/${infoJSON.version}`;
            // info.zcashdVersion = infoJSON.zcashd_version;
            info.verificationProgress = 1;
            info.currencyName = info.testnet ? "TAZ" : "ZEC";
            info.solps = 0;
            info.zecPrice = await this.getZecPrice();

            // const encStatus = native.zingolib_execute("encryptionstatus", "");
            // const encJSON = JSON.parse(encStatus);
            // info.encrypted = encJSON.encrypted;
            // info.locked = encJSON.locked;

            const walletHeight = this.fetchWalletHeight();
            info.walletHeight = walletHeight;

            return info;
        }
        catch(err) {
            console.log("Failed to parse info", err);
            return new Info();
        }
    }

    async fetchInfo() {
        const info = await this.getInfoObject();
        this.info = info;

        return info.latestBlock;
    }

    fetchSeed() {
        const seedStr = native.zingolib_execute("seed", "");
        const seedJSON = JSON.parse(seedStr);
    
        return seedJSON.seed;
    }

    getWalletBirthday() {        
        const birthdayStr = native.zingolib_execute("get_birthday", "");        
    
        return birthdayStr;
    }

    exportUfvkAsString() {
        const ufvkStr = native.zingolib_execute("exportufvk", "");
        const ufvkJSON = JSON.parse(ufvkStr);
    
        return ufvkJSON.ufvk;
    }

    fetchTotalBalance() {
        const balanceJSON = JSON.parse(native.zingolib_execute('balance',''));        
        const balance = new TotalBalance();

        // Every sapling balance
        balance.sapling_balance = balanceJSON.sapling_balance / 10 ** 8;
        balance.verified_sapling_balance = balanceJSON.verified_sapling_balance / 10 ** 8;
        balance.spendable_sapling_balance = balanceJSON.spendable_sapling_balance / 10 ** 8;
        balance.unverified_sapling_balance = balanceJSON.unverified_sapling_balance / 10 ** 8;

        // Every orchard balance
        balance.orchard_balance = balanceJSON.orchard_balance / 10 ** 8;
        balance.verified_orchard_balance = balanceJSON.verified_orchard_balance / 10 ** 8;
        balance.spendable_orchard_balance = balanceJSON.spendable_orchard_balance / 10 ** 8;
        balance.unverified_orchard_balance = balanceJSON.unverified_orchard_balance / 10 ** 8;

        // Transparent balance
        balance.transparent_balance = balanceJSON.transparent_balance / 10 ** 8;

        balance.total = balance.sapling_balance + balance.orchard_balance + balance.transparent_balance;

        return balance;

    }

    fetchNotes() {
        const notes = native.zingolib_execute("notes", "");
        const notesJSON = JSON.parse(notes);

        return notesJSON;
    }

    fetchUnspentNotes() {
        const unspentNotes = native.zingolib_execute("notes", "");
        const unspentJSON = JSON.parse(unspentNotes);
        const addresses = this.fetchAllAddresses();
    
        const addressBalances = {
                orchard: [],
                sapling: [],
                transparent: []
            };
    
        // Process orchard notes
        unspentJSON.unspent_orchard_notes.forEach((s) => {
            addressBalances.orchard.push({address: s.address, value: s.value});
        });

        // Process sapling notes
        unspentJSON.unspent_sapling_notes.forEach((s) => {
            let z_address = addresses.filter((addr) => s.address === addr.address);
            addressBalances.sapling.push({address: z_address[0].receivers.sapling, value: s.value});
        });
    
        // Process UTXOs
        unspentJSON.utxos.forEach((s) => {
            let t_address = addresses.filter((addr) => s.address === addr.address);
            addressBalances.transparent.push({address: t_address[0].receivers.transparent, value: s.value});
        });
        
        return addressBalances;
    }

    fetchPendingNotes() {
        const pendingNotes = native.zingolib_execute("notes", "");
        const pendingJSON = JSON.parse(pendingNotes);
        const addresses = this.fetchAllAddresses();
    
        const pendingAddressBalances = {
            orchard: [],
            sapling: [],
            transparent: []
        };
    
        // Process orchard notes
        pendingJSON.pending_orchard_notes.forEach((s) => {
            pendingAddressBalances.orchard.push({address: s.address, value: s.value});
        });

        // Process sapling notes
        pendingJSON.pending_sapling_notes.forEach((s) => {
            let z_address = addresses.filter((addr) => s.address === addr.address);
            pendingAddressBalances.sapling.push({address: z_address[0].receivers.sapling, value: s.value});
        });
    
        // Process UTXOs
        pendingJSON.pending_utxos.forEach((s) => {
            let t_address = addresses.filter((addr) => s.address === addr.address);
             pendingAddressBalances.transparent.push({address: t_address[0].receivers.transparent, value: s.value});
        });
        
        return pendingAddressBalances;
    }

    fetchAllAddresses() {
        const addressesJSON = JSON.parse(native.zingolib_execute("addresses", ""));
        return addressesJSON;
    }

    groupNotes(notes) {
        let result = notes.reduce((acc, obj) => {
            let key = obj['address'];
            if (!acc[key]) {
                acc[key] = obj.value;
            } else {
                acc[key] += obj.value;
            }
            return acc;
        }, {});
        return Object.entries(result);
    }

    fetchAddressesWithBalance() {
        const addressBalancesJSON = this.fetchUnspentNotes();
        const pendingAddressBalances = this.fetchPendingNotes();
       
        const balanceJSON = {
            ua_addresses: [],
            z_addresses: [],
            t_addresses: []
        };

        // group orchard balances
        const o_notes = this.groupNotes(addressBalancesJSON.orchard)
        o_notes.forEach(([el, val]) =>{
            balanceJSON.ua_addresses.push({
                address: el,
                balance: val
            });
        });

        // group sapling balances
        const z_notes = this.groupNotes(addressBalancesJSON.sapling)
        z_notes.forEach(([el, val]) =>{
            balanceJSON.z_addresses.push({
                address: el,
                balance: val
            });
        });        

        // group transparent balances
        const t_notes = this.groupNotes(addressBalancesJSON.transparent)
        t_notes.forEach(([el, val]) =>{
            balanceJSON.t_addresses.push({
                address: el,
                balance: val
            });
        });
        // return balanceJSON

        // Addresses with Balance. The lite client reports balances in zatoshi, so divide by 10^8;
        const pendingOrchardNotes = new Map();
        pendingAddressBalances.orchard.forEach((note) => {
            pendingOrchardNotes.set(note.address, note.value);
        });
        const oaddresses = balanceJSON.ua_addresses
        .map((o) => {
            // If this has any unconfirmed txns, show that in the UI
            const ab = new AddressBalance(o.address, o.balance / 10 ** 8);
            if (pendingOrchardNotes.has(ab.address)) {
                ab.containsPending = true;
            }
            return ab;
        });        

        const pendingSaplingNotes = new Map();
        pendingAddressBalances.sapling.forEach((note) => {
            pendingSaplingNotes.set(note.address, note.value);
        });
        const zaddresses = balanceJSON.z_addresses
        .map((o) => {
            // If this has any unconfirmed txns, show that in the UI
            const ab = new AddressBalance(o.address, o.balance / 10 ** 8);
            if (pendingSaplingNotes.has(ab.address)) {
               ab.containsPending = true;
            }
            return ab;
        });

        const pendingUtxos = new Map();
        pendingAddressBalances.sapling.forEach((note) => {
            pendingUtxos.set(note.address, note.value);
        });
        const taddresses = balanceJSON.t_addresses
        .map((o) => {
            // If this has any unconfirmed txns, show that in the UI
            const ab = new AddressBalance(o.address, o.balance / 10 ** 8);
            if (pendingUtxos.has(ab.address)) {
                ab.containsPending = true;
            }
        return ab;
        });

        const addresses = oaddresses.concat(zaddresses.concat(taddresses));
        return addresses;
    }    

    getDefaultFee() {
        const fee = JSON.parse(native.zingolib_execute('defaultfee',''));
        return parseFloat(fee.defaultfee);
    }

    async getZecPrice() {
        const res = native.zingolib_execute('updatecurrentprice','');
        if(res.toString().toLowerCase().startsWith('error')) return 0;
        
        return parseFloat(res);
        
        // const now = new Date().getTime();
        // if(this.lastPriceFetch && (now - this.lastPriceFetch) < 5 * 60 * 1000) {
        //     // console.log(this.lastZecPrice)
        //     return this.lastZecPrice;
        // }
        
        // await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd').then(res => {                        
        //     this.lastZecPrice = res.data.zcash.usd;
        // }).catch(err => {
        //     console.log(`Coundn't get ZEC price: ${err}`);
        //     if(!this.lastZecPrice) this.lastZecPrice = 0;
        // })

        // // console.log(this.lastZecPrice)
        // this.lastPriceFetch = now;
        // return parseFloat(this.lastZecPrice);
    }

    getSendProgress() {
        const res = JSON.parse(native.zingolib_execute('sendprogress', ''));
        return res;
    }

    getTransactionsList() {
        // this.fetchTandZTransactions();
        return this.transactionsList;
    }

    fetchWalletHeight() {
        const res = native.zingolib_execute('height','');
        return JSON.parse(res).height;
    }

    async fetchLatestBlockHeight() {
        const res = await this.fetchInfo();
        return res;
    }

    fetchLastTxId() {
        const txListStr = native.zingolib_execute("list", "");
        const txListJSON = JSON.parse(txListStr);

        if (txListJSON && txListJSON.length) {
            return txListJSON[txListJSON.length - 1].txid;
        } else {
            return '0';
        }
    }

    fetchTxList() {
        const res = native.zingolib_execute('list','');
        return JSON.parse(res);
    }

    async fetchWalletSettings() {
        const download_memos_str = native.zingolib_execute("getoption", "download_memos");
        const download_memos = JSON.parse(download_memos_str).download_memos;

        let spam_filter_threshold = "0";
        try {
            const spam_filter_str = native.zingolib_execute("getoption", "spam_filter_threshold");
            spam_filter_threshold = JSON.parse(spam_filter_str).spam_filter_threshold;
            // console.log(`Spam filter threshold: ${spam_filter_threshold}`);

            // If it is -1, i.e., it was not set, then set it to 50
            if (spam_filter_threshold === "-1") {
                await this.setWalletSettingOption("spam_filter_threshold", "50");
            }
        } catch (e) {
            console.log(`Error getting spam filter threshold: ${e}`);
        }

        const wallet_settings = new WalletSettings();
        wallet_settings.download_memos = download_memos;
        wallet_settings.spam_filter_threshold = parseInt(spam_filter_threshold);

        this.walletSettings = wallet_settings;
        return wallet_settings;
  }

    async setWalletSettingOption(name, value) {
        return new Promise((resolve, reject) => {
            try {
                const r = native.zingolib_execute("setoption", `${name}=${value}`);
                if(r.toLowerCase().startsWith("error")) reject(r)

                native.zingolib_execute('save','');

                resolve(r)
            }
            catch(err) {
                reject(err);
                throw(err);
            }                        
        });                
    }

    // async encryptWallet(password) {
    //     return new Promise((resolve, reject) => {
    //         const resultStr = native.zingolib_execute("encrypt", password);
    //         const resultJSON = JSON.parse(resultStr);
    
    //         // And save the wallet
    //         native.zingolib_execute('save','');

    //         if (resultJSON.result === "success") resolve("success");
    //         else reject(`Error! ${resultJSON.error}`);
    //     });                
    // }
    
    // async decryptWallet(password) {  
    //     return new Promise((resolve, reject) => {
    //         const resultStr = native.zingolib_execute("decrypt", password);
    //         const resultJSON = JSON.parse(resultStr);
        
    //         // And save the wallet
    //         native.zingolib_execute('save','');
        
    //         if (resultJSON.result === "success") resolve("success");
    //         else reject(`Error! ${resultJSON.error}`);
    //     });
    // }
    
    // async lockWallet() {
    //     return new Promise((resolve, reject) => {
    //         const resultStr = native.zingolib_execute("lock", "");
    //         const resultJSON = JSON.parse(resultStr);

    //         if (resultJSON.result === "success") resolve("success");
    //         else reject(`Error! ${resultJSON.error}`);
    //     });
    // }

    // async unlockWallet(password) {
    //     return new Promise((resolve, reject) => {
    //         const resultStr = native.zingolib_execute("unlock", password);
    //         const resultJSON = JSON.parse(resultStr);
            
    //         if (resultJSON.result === "success") resolve("success");
    //         else reject(`Error! ${resultJSON.error}`);
    //     });  
    // }

    // encryptionStatus() {
    //     const resultStr = native.zingolib_execute("encryptionstatus", "");
    //     const resultJson = JSON.parse(resultStr);
    //     return resultJson;
    // }

    encryptMessage(addr, msg) {
        return new Promise((resolve, reject) => {
            const json = {
                address: addr,
                memo: msg
            };
            const resultStr = native.zingolib_execute("encryptmessage", JSON.stringify(json));
            const resultJson = JSON.parse(resultStr);
            if(!resultJson.error) {
                resolve(resultJson.encrypted_base64);
            }
            else {
                reject(resultJson.error);
            }         
        });
    }

    async decryptMessage(msg) {
        return new Promise((resolve, reject) => {
            const resultStr = native.zingolib_execute("decryptmessage", msg);
            const resultJson = JSON.parse(resultStr);            
            if(!resultJson.error) {
                resolve(resultJson);
            }
            else {
                reject(resultJson.error);
            }
        });
    }

    doRescan() {
        const syncstr = native.zingolib_execute("rescan", "");
        console.log(`rescan exec result: ${syncstr}`);        
    }

    parseAddress(addr) {
        const res = native.zingolib_execute("parse_address", addr);        
        try {
            const resJson = JSON.parse(res);
            return resJson;
        } 
        catch(err) {
            return null;
        }
    }

    clearTimers() {
        if (this.refreshTimerID) {
            clearInterval(this.refreshTimerID);
            this.refreshTimerID = undefined;
        }
      
        if (this.updateTimerId) {
            clearInterval(this.updateTimerId);
            this.updateTimerId = undefined;
        }
    }

    deinitialize() {        
        this.clearTimers();
        native.zingolib_execute('save','');
        native.zingolib_deinitialize();
        process.exit();
    }
}

module.exports = LiteWallet;