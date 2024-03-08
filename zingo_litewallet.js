const native = require("./native.node");
const { TxDetail, Transaction, TotalBalance, Address, AddressBalance, WalletSettings, Info } = require('./utils/classes');


class LiteWallet {
    constructor(url, chain, readOnly) {
        this.url = url;
        this.chain = chain || "main";

        this.refreshTimerID;
        this.updateTimerID;
        this.syncStatusTimerID;
      
        this.updateDataLock;
        this.updateDataCtr;             
        this.lastWalletBlockHeight = 0;
        this.lastServerBlockHeight = 0;
        this.walletBirthday = 0;

        this.infoObject;
        this.walletSettings;
        this.allAddresses;
        this.transactionsList;
        this.syncingStatus;

        this.inRefresh = false;
        this.inSend = false;
        this.blocksPerBatch = 100;

        this.prev_batch_num = -1;
        this.prev_sync_id = -1;
        this.prev_current_block = -1;
        this.seconds_batch = 0;
        this.seconds_block = 0;
        this.batches = 0;
        this.latest_block = -1;
        this.sync_id = -1;
      
        this.timers = [];
      
        this.readOnly = readOnly;
        
        this.updateDataLock = false;
        this.updateDataCtr = 0;
    }

    restore(mnemonic, birthday, allowOverwrite) {
        return new Promise(async (resolve, reject) => {
            if(mnemonic) {
                const birth = birthday || 0;
                const result = await native.zingolib_initialize_new_from_phrase(this.url, mnemonic, birth, allowOverwrite, this.chain);
                if (result.startsWith("Error")) {
                    reject(result);
                }
                resolve('success');
            }
        });
    }
    
    init() {
        return new Promise(async (resolve, reject) => {            
            if(!native.zingolib_wallet_exists(this.chain)) {                
                console.log('Wallet not configured, creating new one!');
                const res = native.zingolib_initialize_new(this.url, this.chain);
                if(res.toString().toLowerCase().startsWith('error')) {
                    reject("Error: Couldn't create a wallet");
                }
                else {
                    const seed = await native.zingolib_execute_async("seed", "");
                    console.log("Wallet created! Please save the wallet seed:\n" + seed);                    
                }
            }
            
            let res = native.zingolib_initialize_existing(this.url, this.chain);            
            if(res !== 'OK') {
                reject('Something went wrong while initializing the wallet. \n'+ res + '\nQuitting ...');
                return;
            }

            // First things first, I need to stop an existing sync process (if any)
             // clean start.
            await this.stopSyncProcess();
            
            // every 30 seconds the App try to Sync the new blocks.
            if (!this.refreshTimerID) {
                this.refreshTimerID = setInterval(() => {
                    //console.log('interval refresh');
                    this.refreshSimple(false);
                }, 30 * 1000); // 30 seconds
                //console.log('create refresh timer', this.refreshTimerID);
                this.timers.push(this.refreshTimerID);
            }

            // every 5 seconds the App update all data
            // if (!this.updateTimerID) {
            //     this.updateTimerID = setInterval(() => {
            //         //console.log('interval update', this.timers);
            //         this.sanitizeTimers();
            //         this.updateData();
            //     }, 5 * 1000); // 5 secs
            //     //console.log('create update timer', this.updateTimerID);
            //     this.timers.push(this.updateTimerID);
            // }

            // and now the array of timers...
            let deleted = [];
            for (var i = 0; i < this.timers.length; i++) {
                if (this.timers[i] !== this.refreshTimerID && this.timers[i] !== this.updateTimerID) {
                    clearInterval(this.timers[i]);
                    deleted.push(i);
                    //console.log('kill item array timers', this.timers[i]);
                }
            }
            
            // remove the cleared timers.
            for (var i = 0; i < deleted.length; i++) {
                this.timers.splice(deleted[i], 1);
            }

            // Load the current wallet data
            await this.loadWalletData();
            
            // Call the refresh after configure
            this.refresh(true);
            resolve("ok");
        });
    }

    async rpc_getInfoObject() {
        try {
            const infoStr = await native.zingolib_execute_async('info', '');
            if (infoStr) {
                if (infoStr.toLowerCase().startsWith('error')) {
                    console.log(`Error info ${infoStr}`);
                    return {};
                }
            } else {
                console.log('Internal Error info');
                return {};
            }
            const infoJSON = await JSON.parse(infoStr);

            const defaultFeeStr = await native.zingolib_execute_async('defaultfee', '');
            if (defaultFeeStr) {
                if (defaultFeeStr.toLowerCase().startsWith('error')) {
                    console.log(`Error defaultfee ${defaultFeeStr}`);
                    return {};
                }
            } else {
                console.log('Internal Error defaultfee');
                return {};
            }
            const defaultFeeJSON = await JSON.parse(defaultFeeStr);

            let zingolibStr = await native.zingolib_execute_async('version', '');
            if (zingolibStr) {
                if (zingolibStr.toLowerCase().startsWith('error')) {
                    console.log(`Error zingolib version ${zingolibStr}`);
                    zingolibStr = '<error>';
                }
            } else {
                console.log('Internal Error zingolib version');
                zingolibStr = '<none>';
            }
            //const zingolibJSON = await JSON.parse(zingolibStr);

            const info = new Info();
            
            info.chain_name = infoJSON.chain_name;
            info.latestBlock = infoJSON.latest_block_height;
            info.serverUri = infoJSON.server_uri || '<none>';
            info.connections = 1;
            info.version = `${infoJSON.vendor}/${infoJSON.git_commit.substring(0, 6)}/${infoJSON.version}`;
            info.verificationProgress = 1;
            info.currencyName = infoJSON.chain_name === 'main' ? 'ZEC' : 'TAZ';
            info.solps = 0;
            info.defaultFee = defaultFeeJSON.defaultfee / 10 ** 8 || 10000 / 10 ** 8;
            info.zingolib = zingolibStr;
            
            return info;
        }
        catch (error) {
            console.log(`Critical Error info and/or defaultfee ${error}`);
            return {};
        }
    }

    async rpc_fetchWallet(readOnly) {
        if (readOnly) {
            // viewing key
            try {
                const ufvkStr = await native.zingolib_execute_async('exportufvk', '');
                if (ufvkStr) {
                    if (ufvkStr.toLowerCase().startsWith('error')) {
                        console.log(`Error ufvk ${ufvkStr}`);
                        return {};
                    }
                } else {
                    console.log('Internal Error ufvk');
                    return {};
                }
                const ufvk = JSON.parse(ufvkStr);
      
                return ufvk;
            } catch (error) {
              console.log(`Critical Error ufvk / get_birthday ${error}`);
              return {};
            }
        } else {
            // seed
            try {
                const seedStr = await native.zingolib_execute_async('seed', '');
                if (seedStr) {
                    if (seedStr.toLowerCase().startsWith('error')) {
                        console.log(`Error seed ${seedStr}`);
                        return {};
                    }
                } else {
                    console.log('Internal Error seed');
                    return {};
                }
                const RPCseed = JSON.parse(seedStr);
                const seed = {};
                if (RPCseed.seed) {
                    seed.seed = RPCseed.seed;
                }
                if (RPCseed.birthday) {
                    seed.birthday = RPCseed.birthday;
                }
      
                return seed;
            } catch (error) {
              console.log(`Critical Error seed ${error}`);
              return {};
            }
        }
    }

    // We combine detailed transactions if they are sent to the same outgoing address in the same txid. This
    // is usually done to split long memos.
    // Remember to add up both amounts and combine memos
    rpc_combineTxDetailsByAddress(txdetails) {
        // First, group by outgoing address.
        const m = new Map();

        txdetails
        .filter(i => i.address !== undefined)
        .forEach(i => {
            const coll = m.get(i.address);
            if (!coll) {
                m.set(i.address, [i]);
            } else {
                coll.push(i);
            }
        });

        // Reduce the groups to a single TxDetail, combining memos and summing amounts
        const reducedDetailedTxns = [];
        m.forEach((txns, toaddr) => {
            const totalAmount = txns.reduce((sum, i) => sum + i.amount, 0);

            const memos = txns
            .filter(i => i.memos && i.memos.length > 0)
            .map(i => {
                const combinedMemo = i.memos
                .filter(memo => memo)
                .map(memo => {
                    const rex = /\((\d+)\/(\d+)\)((.|[\r\n])*)/;
                    const tags = memo.match(rex);
                    if (tags && tags.length >= 4) {
                        return { num: parseInt(tags[1], 10), memo: tags[3] };
                    }
                    // Just return as is
                    return { num: 0, memo };
                })
                .sort((a, b) => a.num - b.num)
                .map(a => a.memo);
                return combinedMemo && combinedMemo.length > 0 ? combinedMemo.join('') : undefined;
            })
            .map(a => a);

            const detail = new TxDetail();
            detail.address = toaddr,
            detail.amount = totalAmount,
            detail.memos = (memos && memos.length > 0 ? [memos.join('')] : undefined)
            
            reducedDetailedTxns.push(detail);
        });
        return reducedDetailedTxns;
    }

    // We combine detailed transactions if they are received to the same pool in the same txid. This
    // is usually done to split long memos.
    // Remember to add up both amounts and combine memos      
    rpc_combineTxDetailsByPool(txdetails) {
        // First, group by pool.
        const m = new Map();

        txdetails
        .filter(i => i.pool !== undefined)
        .forEach(i => {
            const coll = m.get(i.pool);
            if (!coll) {
                m.set(i.pool, [i]);
            } else {
            coll.push(i);
            }
        });

        // Reduce the groups to a single TxDetail, combining memos and summing amounts
        const reducedDetailedTxns = [];
        m.forEach((txns, pool) => {
            const totalAmount = txns.reduce((sum, i) => sum + i.amount, 0);

            const memos = txns
            .filter(i => i.memos && i.memos.length > 0)
            .map(i => {
                const combinedMemo = i.memos
                .filter(memo => memo)
                .map(memo => {
                    const rex = /\((\d+)\/(\d+)\)((.|[\r\n])*)/;
                    const tags = memo.match(rex);
                    if (tags && tags.length >= 4) {
                        return { num: parseInt(tags[1], 10), memo: tags[3] };
                    }
    
                    // Just return as is
                    return { num: 0, memo };
                })
                .sort((a, b) => a.num - b.num)
                .map(a => a.memo);
                return combinedMemo && combinedMemo.length > 0 ? combinedMemo.join('') : undefined;
            })
            .map(a => a);
    
            const detail = new TxDetail();
            detail.address = '';
            detail.amount = totalAmount;
            detail.memos = (memos && memos.length > 0 ? [memos.join('')] : undefined);
            detail.pool = pool;
            
            reducedDetailedTxns.push(detail);            
        });

        return reducedDetailedTxns;
    }

    async rpc_setInterruptSyncAfterBatch(value) {
        try {
            const resultStr = await native.zingolib_execute_async('interrupt_sync_after_batch', value);
      
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

    async rpc_doRescan() {
        return new Promise(async (resolve, reject) => {
            try {
                const rescanStr = await native.zingolib_execute_spawn("rescan", "");
                if (rescanStr) {
                    if (rescanStr.toLowerCase().startsWith('error')) {
                        console.log(`Error rescan ${rescanStr}`);
                        reject(rescanStr);
                    }
                } else {
                    console.log('Internal Error rescan');
                    reject('Error: Internal RPC Error: rescan');
                }
                await this.fetchInfoAndServerHeight();
                const res = {
                    result: 'success',
                    latest_block: this.lastServerBlockHeight
                }
                resolve(JSON.stringify(res));
            } catch (error) {
                console.log(`Critical Error rescan ${error}`);
                reject(`Error: ${error}`);
            }
        });
    }

    async rpc_doSync() {
        return new Promise(async (resolve, reject) => {
            try {
                const syncStr = await native.zingolib_execute_spawn('sync', '');                
                if (syncStr) {
                    if (syncStr.toLowerCase().startsWith('error')) {
                        console.log(`Error sync ${syncStr}`);
                        reject(syncStr);
                    }
                } else {
                    console.log('Internal Error sync');
                    reject('Error: Internal RPC Error: sync');
                }
                await this.fetchInfoAndServerHeight();
                const res = {
                    result: 'success',
                    latest_block: this.lastServerBlockHeight
                }
                resolve(JSON.stringify(res));
            } catch (error) {
                console.log(`Critical Error sync ${error}`);
                reject(`Error: ${error}`);
            }
        });
    }

    async rpc_doSave() {
        try {
            const saveStr = await native.zingolib_execute_async('save','');
            if (saveStr) {
                if (saveStr.toLowerCase().startsWith('error')) {
                    console.log(`Error save ${saveStr}`);
                }
            } else {
                console.log('Internal Error save');
            }
        } catch (error) {
            console.log(`Critical Error save ${error}`);
        }        
    }

    async stopSyncProcess()  {
        let returnStatus = await this.doSyncStatus();
        if (returnStatus.toLowerCase().startsWith('error')) {
            return;
        }
        let ss = {};
        try {
            ss = await JSON.parse(returnStatus);
        } catch (e) {
            return;
        }
    
        console.log('stop sync process. in progress', ss.in_progress);
    
        while (ss.in_progress) {
            // interrupting sync process
            await this.rpc_setInterruptSyncAfterBatch('true');
    
            // sleep for half second
            // await this.sleep(500);
    
            returnStatus = await this.doSyncStatus();
            ss = await JSON.parse(returnStatus);
    
            console.log('stop sync process. in progress', ss.in_progress);
        }
        console.log('stop sync process. STOPPED');
    
        // NOT interrupting sync process
        await this.rpc_setInterruptSyncAfterBatch('false');
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

    async sanitizeTimers() {
        // and now the array of timers...
        let deleted = [];
        for (var i = 0; i < this.timers.length; i++) {
            if (
                this.timers[i] !== this.refreshTimerID &&
                this.timers[i] !== this.updateTimerID &&
                this.timers[i] !== this.syncStatusTimerID
            ) {
                clearInterval(this.timers[i]);
                deleted.push(i);
                //console.log('sanitize - kill item array timers', this.timers[i]);
            }
        }
        // remove the cleared timers.
        for (var i = 0; i < deleted.length; i++) {
            this.timers.splice(deleted[i], 1);
        }
    }

    async loadWalletData() {
        await this.fetchTotalBalance();
        await this.fetchTandZandOTransactionsSummaries();
        await this.fetchWalletSettings();
        await this.fetchInfoAndServerHeight();
    }

    async updateData() {
        //console.log("Update data triggered");
        if (this.updateDataLock) {
            //console.log("Update lock, returning");
            return;
        }
    
        this.updateDataCtr += 1;
        if ((this.inRefresh || this.inSend) && this.updateDataCtr % 5 !== 0) {
            // We're refreshing, or sending, in which case update every 5th time
            return;
        }
    
        this.updateDataLock = true;
    
        await this.fetchWalletHeight();
        await this.fetchWalletBirthday();
        await this.fetchInfoAndServerHeight();
    
        // And fetch the rest of the data.
        await this.loadWalletData();
    
        //console.log(`Finished update data at ${lastServerBlockHeight}`);
        this.updateDataLock = false;
    }

    async refresh(fullRefresh, fullRescan) {
        // If we're in refresh, we don't overlap
        if (this.inRefresh) {
            //console.log('in refresh is true');
            return;
        }

        if (this.syncStatusTimerID) {
            //console.log('syncStatusTimerID exists already');
            return;
        }

        // And fetch the rest of the data.
        await this.loadWalletData();

        await this.fetchWalletHeight();
        await this.fetchWalletBirthday();
        await this.fetchInfoAndServerHeight();

        if (!this.lastServerBlockHeight) {
            //console.log('the last server block is zero');
            return;
        }

        // if it's sending now, don't fire the sync process.
        if (
            fullRefresh ||
            fullRescan ||
            !this.lastWalletBlockHeight ||
            this.lastWalletBlockHeight < this.lastServerBlockHeight
        ) {
            // If the latest block height has changed, make sure to sync. This will happen in a new thread
            this.inRefresh = true;            
  
            this.prev_batch_num = -1;
            this.prev_sync_id = -1;
            this.seconds_batch = 0;
            this.seconds_block = 0;
            this.batches = 0;
            this.latest_block = -1;
            this.prev_current_block = -1;
  
            // This is async, so when it is done, we finish the refresh.
            if (fullRescan) {
                // clean the transaction list before.
                this.transactionsList = [];
                this.totalBalance.orchardBal = 0;
                this.privateBal = 0;
                this.transparentBal = 0;
                this.spendableOrchard = 0;
                this.spendablePrivate = 0;
                this.total = 0;
                
                this.rpc_doRescan()
                .then(result => {
                    console.log('rescan finished', result);
                    if (result && !result.toLowerCase().startsWith('error')) {
                        const resultJSON = JSON.parse(result);
                        if (resultJSON.result === 'success' && resultJSON.latest_block) {
                            this.latest_block = resultJSON.latest_block;
                        }
                    } 
                })
                .catch(error => console.log('rescan error', error));
                //.finally(() => {
                // with the new feature shardtree I can get an error here, but
                // doesn't mean the sync/rescan process is finished, I have to
                // rely on syncstatus finished instead
                //this.inRefresh = false;
                //});
            } else {
                this.rpc_doSync()
                .then(result => {
                    console.log('sync finished', result);
                    if (result && !result.toLowerCase().startsWith('error')) {
                        const resultJSON = JSON.parse(result);
                        if (resultJSON.result === 'success' && resultJSON.latest_block) {
                            this.latest_block = resultJSON.latest_block;
                        }
                    }
                })
                .catch(error => console.log('sync error', error));
                //.finally(() => {
                // with the new feature shardtree I can get an error here, but
                // doesn't mean the sync/rescan process is finished, I have to
                // rely on syncstatus finished instead
                //this.inRefresh = false;
                //this.keepAwake(false);
                //});
            }

            // We need to wait for the sync to finish. The sync is done when
            this.syncStatusTimerID = setInterval(async () => {
                const returnStatus = await this.doSyncStatus();
                if (returnStatus.toLowerCase().startsWith('error')) {
                    return;
                }
                let ss = {};
                try {
                    ss = JSON.parse(returnStatus);
                } catch (e) {
                    return;
                }

                // console.log('sync wallet birthday', this.walletBirthday);
                //console.log('sync', this.syncStatusTimerID);
                console.log(
                    'synced',
                    ss.synced_blocks,
                    'trial_decryptions',
                    ss.trial_decryptions_blocks,
                    'txn_scan',
                    ss.txn_scan_blocks,
                    'witnesses',
                    ss.witnesses_updated,
                    'TOTAL',
                    ss.total_blocks,
                    'batch_num',
                    ss.batch_num,
                    'batch_total',
                    ss.batch_total,
                    'end_block',
                    ss.end_block,
                    'start_block',
                    ss.start_block,
                );
                //console.log('--------------------------------------');

                // synchronize status
                if (this.syncStatusTimerID) {
                    this.inRefresh = ss.in_progress;
                }

                this.sync_id = ss.sync_id;

                // if the sync_id change then reset the %
                if (this.prev_sync_id !== this.sync_id) {
                    if (this.prev_sync_id !== -1) {
                        // And fetch the rest of the data.
                        await this.loadWalletData();
  
                        await this.fetchWalletHeight();
                        await this.fetchWalletBirthday();
                        await this.fetchInfoAndServerHeight();
  
                        await this.rpc_doSave();
  
                        //console.log('sync status', ss);
                        //console.log(`new sync process id: ${this.sync_id}. Save the wallet.`);
                        this.prev_batch_num = -1;
                        this.seconds_batch = 0;
                        this.seconds_block = 0;
                        this.batches = 0;
                    }
                    this.prev_sync_id = this.sync_id;
                }

                // Post sync updates
                let synced_blocks = ss.synced_blocks || 0;
                let trial_decryptions_blocks = ss.trial_decryptions_blocks || 0;
                let txn_scan_blocks = ss.txn_scan_blocks || 0;
                let witnesses_updated = ss.witnesses_updated || 0;

                // just in case
                if (synced_blocks < 0) {
                    synced_blocks = 0;
                 }
                if (synced_blocks > this.blocksPerBatch) {
                    synced_blocks = this.blocksPerBatch;
                }
                if (trial_decryptions_blocks < 0) {
                    trial_decryptions_blocks = 0;
                }
                if (trial_decryptions_blocks > this.blocksPerBatch) {
                    trial_decryptions_blocks = this.blocksPerBatch;
                }
                if (txn_scan_blocks < 0) {
                    txn_scan_blocks = 0;
                }
                if (txn_scan_blocks > this.blocksPerBatch) {
                    txn_scan_blocks = this.blocksPerBatch;
                }
                if (witnesses_updated < 0) {
                    witnesses_updated = 0;
                }
                if (witnesses_updated > this.blocksPerBatch) {
                    witnesses_updated = this.blocksPerBatch;
                }

                const batch_total = ss.batch_total || 0;
                const batch_num = ss.batch_num || 0;

                const end_block = ss.end_block || 0; // lower

                 // I want to know what was the first block of the current sync process
                let process_end_block = 0;
                // when the App is syncing the new blocks and sync finished really fast
                // the synstatus have almost all of the fields undefined.
                // if we have latest_block means that the sync process finished in that block
                if (end_block === 0 && batch_num === 0) {
                    process_end_block = this.latest_block !== -1 ? this.latest_block : this.lastServerBlockHeight;
                } else {
                    process_end_block = end_block - batch_num * this.blocksPerBatch;
                }

                //const progress_blocks = (synced_blocks + trial_decryptions_blocks + txn_scan_blocks) / 3;
                const progress_blocks = (synced_blocks + trial_decryptions_blocks + witnesses_updated) / 3;

                // And fetch the rest of the data.
                //await this.loadWalletData();

                //await this.fetchWalletHeight();
                //await this.fetchWalletBirthday();
                //await this.fetchServerHeight();

                let current_block = end_block + progress_blocks;
                if (current_block > this.lastServerBlockHeight) {
                    current_block = this.lastServerBlockHeight;
                }
                current_block = parseInt(current_block.toFixed(0), 10);

                // if the current block is stalled I need to restart the App
                let syncProcessStalled = false;
                if (this.prev_current_block !== -1) {
                    //console.log(
                        //  'BEFORE prev current block',
                        //  this.prev_current_block,
                        //  'current block',
                        //  current_block,
                        //  'seconds',
                        //  this.seconds_block,
                        //  'blocks',
                        //  current_block - this.prev_current_block,
                    //);
                    if (current_block > 0 && this.prev_current_block === current_block) {
                        this.seconds_block += 5;
                        // 5 minutes
                        if (this.seconds_block >= 300) {
                            this.seconds_block = 0;
                            syncProcessStalled = true;
                        }
                    }
                    if (current_block > 0 && this.prev_current_block !== current_block) {
                        this.seconds_block = 0;
                        syncProcessStalled = false;
                    }
                }

                //console.log(
                //  'AFTER prev current block',
                //  this.prev_current_block,
                //  'current block',
                //  current_block,
                //  'seconds',
                //  this.seconds_block,
                //  'stalled',
                //  syncProcessStalled,
                //);

                // if current block is lower than the previous current block
                // The user need to see something not confusing.
                if (current_block > 0 && this.prev_current_block !== -1 && current_block < this.prev_current_block) {
                    //console.log('blocks down', current_block - this.prev_current_block);
                    // I decided to add only one fake block because otherwise could seems stalled
                    // the user expect every 5 seconds the blocks change...
                    current_block = this.prev_current_block + 1;
                }


                this.prev_current_block = current_block;

                this.seconds_batch += 5;

                //console.log('interval sync/rescan, secs', this.seconds_batch, 'timer', this.syncStatusTimerID);

                // store SyncStatus object for a new screen
                this.syncingStatus = {
                    syncID: this.sync_id,
                    totalBatches: batch_total,
                    currentBatch: ss.in_progress ? batch_num + 1 : 0,
                    lastBlockWallet: this.lastWalletBlockHeight,
                    currentBlock: current_block,
                    inProgress: ss.in_progress,
                    lastError: ss.last_error,
                    blocksPerBatch: this.blocksPerBatch,
                    secondsPerBatch: this.seconds_batch,
                    process_end_block: process_end_block,
                    lastBlockServer: this.lastServerBlockHeight,
                    syncProcessStalled: syncProcessStalled,
                };

                // Close the poll timer if the sync finished(checked via promise above)
                if (!this.inRefresh) {
                    // We are synced. Cancel the poll timer
                    if (this.syncStatusTimerID) {
                        clearInterval(this.syncStatusTimerID);
                        this.syncStatusTimerID = undefined;
                    }

                    // And fetch the rest of the data.
                    await this.loadWalletData();

                    await this.fetchWalletHeight();
                    await this.fetchWalletBirthday();
                    await this.fetchInfoAndServerHeight();

                    await this.rpc_doSave();

                    // store SyncStatus object for a new screen
                    this.syncingStatus = {
                        syncID: this.sync_id,
                        totalBatches: 0,
                        currentBatch: 0,
                        lastBlockWallet: this.lastWalletBlockHeight,
                        currentBlock: current_block,
                        inProgress: false,
                        lastError: ss.last_error,
                        blocksPerBatch: this.blocksPerBatch,
                        secondsPerBatch: 0,
                        process_end_block: process_end_block,
                        lastBlockServer: this.lastServerBlockHeight,
                        syncProcessStalled: false,
                    };

                    //console.log('sync status', ss);
                    //console.log(`Finished refresh at ${this.lastWalletBlockHeight} id: ${this.sync_id}`);
                } else {
                     // If we're doing a long sync, every time the batch_num changes, save the wallet
                    if (this.prev_batch_num !== batch_num) {
                        // if finished batches really fast, the App have to save the wallet delayed.
                        if (this.prev_batch_num !== -1 && this.batches >= 1) {
                            // And fetch the rest of the data.
                            await this.loadWalletData();

                            await this.fetchWalletHeight();
                            await this.fetchWalletBirthday();
                            await this.fetchInfoAndServerHeight();

                            await this.rpc_doSave();
                            this.batches = 0;

                            //console.log('sync status', ss);
                            //console.log(
                            //  `@@@@@@@@@@@ Saving because batch num changed ${this.prevBatchNum} - ${batch_num}. seconds: ${this.seconds_batch}`,
                            //);
                        }
                        this.batches += batch_num - this.prev_batch_num;
                        this.prev_batch_num = batch_num;
                        this.seconds_batch = 0;
                    }
                    // save wallet every 15 seconds in the same batch.
                    /* altum suggestion - remove the mid-batch saving...
                    if (this.seconds_batch > 0 && this.seconds_batch % 15 === 0) {
                        // And fetch the rest of the data.
                        await this.loadWalletData();

                        await this.fetchWalletHeight();
                        await this.fetchWalletBirthday();
                        await this.fetchInfoAndServerHeight();

                        await this.rpc_doSave();

                        // store SyncStatus object for a new screen
                        this.syncingStatus = {
                            syncID: this.sync_id,
                            totalBatches: batch_total,
                            currentBatch: ss.in_progress ? batch_num + 1 : 0,
                            lastBlockWallet: this.lastWalletBlockHeight,
                            currentBlock: current_block,
                            inProgress: ss.in_progress,
                            lastError: ss.last_error,
                            blocksPerBatch: this.blocksPerBatch,
                            secondsPerBatch: this.seconds_batch,
                            process_end_block: process_end_block,
                            lastBlockServer: this.lastServerBlockHeight,
                            syncProcessStalled: false,
                        };

                        //console.log('sync status', ss);
                        //console.log(`@@@@@@@@@@@Saving wallet. seconds: ${this.seconds_batch}`);
                    }
                    */
                }
            }, 5000);
            //console.log('create sync/rescan timer', this.syncStatusTimerID);
            this.timers.push(this.syncStatusTimerID);
        } else {
            // Already at the latest block
            console.log('Already have latest block, waiting for next refresh');
            // Here I know the sync process is over, I need to inform to the UI.
            this.syncingStatus = {
                syncID: this.sync_id,
                totalBatches: 0,
                currentBatch: 0,
                lastBlockWallet: this.lastWalletBlockHeight,
                currentBlock: this.lastWalletBlockHeight,
                inProgress: false,
                lastError: '',
                blocksPerBatch: this.blocksPerBatch,
                secondsPerBatch: 0,
                process_end_block: this.lastServerBlockHeight,
                lastBlockServer: this.lastServerBlockHeight,
                syncProcessStalled: false,
            };
        }
    }

    async refreshSimple(fullRefresh) {
        if (this.syncTimerID) {
            console.log("Already have a sync process launched", this.syncTimerID);
            return;
        }     

        await this.fetchWalletHeight();
        await this.fetchInfoAndServerHeight();
        this.loadWalletData();
        
        if(!this.lastWalletBlockHeight || this.lastWalletBlockHeight < this.lastServerBlockHeight || fullRefresh) {
            console.log('Refreshing wallet: ' + (this.lastServerBlockHeight - this.lastWalletBlockHeight) + ' new blocks.');
            
            this.updateDataLock = true;
            this.inRefresh = true;
            native.zingolib_execute_spawn('sync', '');
            let retryCount = 0;

            this.syncTimerID = setInterval(async () => {
                await this.fetchWalletHeight();
                await this.fetchInfoAndServerHeight();
                // retryCount ++;

                if(retryCount > 30 || this.lastWalletBlockHeight >= this.lastServerBlockHeight) {                    
                    clearInterval(this.syncTimerID);
                    this.syncTimerID = undefined;

                    console.log('Wallet is up to date!');

                    await this.loadWalletData();

                    this.lastBlockHeight = this.lastServerBlockHeight;

                    await this.rpc_doSave();
                    this.updateDataLock = false;
                }
                else {
                    const ssStr = await this.doSyncStatus();
                    const ss = JSON.parse(ssStr);
                    if (!ss.in_progress) {
                        clearInterval(this.syncTimerID);
                        this.syncTimerID = undefined;

                        await this.loadWalletData();

                        this.lastWalletBlockHeight = this.lastServerBlockHeight;
                        this.inRefresh = false;

                        await this.rpc_doSave();
                        this.updateDataLock = false;
                    }
                }                
            }, 5000);
        }
        else console.log('no new blocks');
    }

    async fetchNotes() {
        // Fetch pending notes and UTXOs
        const pendingNotes = await native.zingolib_execute_async('notes', '');
        if (pendingNotes) {
            if (pendingNotes.toLowerCase().startsWith('error')) {
                console.log(`Error notes ${pendingNotes}`);
                return;
            }
            return JSON.parse(pendingNotes);
        } else {
            console.log('Internal Error notes');
            return;
        }
    }

    async fetchTotalBalance() {
        try {                         
            const addressesJSON = await this.fetchAllAddresses();;

            const balanceStr = await native.zingolib_execute_async('balance', '');
            if (balanceStr) {
                if (balanceStr.toLowerCase().startsWith('error')) {
                    console.log(`Error balance ${balanceStr}`);
                    return;
                }
            } else {
                console.log('Internal Error balance');
                return;
            }
            const balanceJSON = JSON.parse(balanceStr);

            const orchardBal = balanceJSON.orchard_balance || 0;
            const privateBal = balanceJSON.sapling_balance || 0;
            const transparentBal = balanceJSON.transparent_balance || 0;

            const total = orchardBal + privateBal + transparentBal;

            // Total Balance
            const balance = new TotalBalance();
            
            balance.orchardBal = orchardBal / 10 ** 8;
            balance.privateBal = privateBal / 10 ** 8;
            balance.transparentBal = transparentBal / 10 ** 8;
            balance.spendableOrchard = (balanceJSON.spendable_orchard_balance || 0) / 10 ** 8;
            balance.spendablePrivate = (balanceJSON.spendable_sapling_balance || 0) / 10 ** 8;
            balance.total = total / 10 ** 8;
            
            this.totalBalance = balance;

            // Fetch pending notes and UTXOs
            const pendingNotes = await native.zingolib_execute_async('notes', '');
            if (pendingNotes) {
                if (pendingNotes.toLowerCase().startsWith('error')) {
                    console.log(`Error notes ${pendingNotes}`);
                    return;
                }
            } else {
                console.log('Internal Error notes');
                return;
            }
            const pendingNotesJSON = JSON.parse(pendingNotes);
            

            const pendingAddress = new Map();

            // Process orchard notes
            if (pendingNotesJSON.pending_orchard_notes) {
                pendingNotesJSON.pending_orchard_notes.forEach((s) => {
                    pendingAddress.set(s.address, s.value);
                });
            } else {
                console.log('ERROR: notes.pending_orchard_notes no exists');
            }

            // Process sapling notes
            if (pendingNotesJSON.pending_sapling_notes) {
                pendingNotesJSON.pending_sapling_notes.forEach((s) => {
                    pendingAddress.set(s.address, s.value);
                });
            } else {
                console.log('ERROR: notes.pending_sapling_notes no exists');
            }

            // Process UTXOs
            if (pendingNotesJSON.pending_utxos) {
                pendingNotesJSON.pending_utxos.forEach((s) => {
                    pendingAddress.set(s.address, s.value);
                });
            } else {
                console.log('ERROR: notes.pending_utxos no exists');
            }

            let allAddresses = [];

            addressesJSON.forEach((u) => {
                // If this has any unconfirmed txns, show that in the UI
                const receivers =
                    (u.receivers.orchard_exists ? 'o' : '') +
                    (u.receivers.sapling ? 'z' : '') +
                    (u.receivers.transparent ? 't' : '');
                if (u.address) {
                    const abu = new Address(u.address, u.address, 'u', receivers);
                    if (pendingAddress.has(abu.address)) {
                        abu.containsPending = true;
                    }
                    allAddresses.push(abu);
                }
                if (u.receivers.sapling) {
                    const abz = new Address(u.address, u.receivers.sapling, 'z', receivers);
                    if (pendingAddress.has(abz.address)) {
                        abz.containsPending = true;
                    }
                    allAddresses.push(abz);
                }
                if (u.receivers.transparent) {
                    const abt = new Address(u.address, u.receivers.transparent, 't', receivers);
                    if (pendingAddress.has(abt.address)) {
                        abt.containsPending = true;
                    }
                    allAddresses.push(abt);
                }
            });

            this.allAddresses = allAddresses;
            return this.totalBalance;
        } catch (error) {
            console.log(`Critical Error notes ${error}`);
            return;
        }
    }

    async fetchTandZandOTransactionsSummaries() {
        try {
            const summariesStr = await native.zingolib_execute_async('summaries', '');
            //console.log(summariesStr);
            if (summariesStr) {
                if (summariesStr.toLowerCase().startsWith('error')) {
                    console.log(`Error txs summaries ${summariesStr}`);
                    return;
                }
            } else {
                console.log('Internal Error txs summaries');
                return;
            }
            const summariesJSON = JSON.parse(summariesStr);

            await this.fetchInfoAndServerHeight();

            let txList = [];

            summariesJSON
            //.filter(tx => tx.kind !== 'Fee')
            .forEach((tx) => {
                let currentTxList = txList.filter(t => t.txid === tx.txid);
                if (currentTxList.length === 0) {
                    currentTxList = [{}];
                    currentTxList[0].txDetails = [];
                }
                let restTxList = txList.filter(t => t.txid !== tx.txid);

                const type = tx.kind === 'Fee' ? 'Sent' : tx.kind;
                if (!currentTxList[0].type && !!type) {
                    currentTxList[0].type = type;
                }
                if (tx.unconfirmed) {
                    currentTxList[0].confirmations = 0;
                } else if (!currentTxList[0].confirmations) {
                    currentTxList[0].confirmations = this.lastServerBlockHeight
                        ? this.lastServerBlockHeight - tx.block_height + 1
                        : this.lastWalletBlockHeight - tx.block_height + 1;
                }
                if (!currentTxList[0].txid && !!tx.txid) {
                    currentTxList[0].txid = tx.txid;
                }
                if (!currentTxList[0].time && !!tx.datetime) {
                    currentTxList[0].time = tx.datetime;
                }
                if (!currentTxList[0].zec_price && !!tx.price && tx.price !== 'None') {
                    currentTxList[0].zec_price = tx.price;
                }

                //if (tx.txid.startsWith('426e')) {
                //  console.log('tran: ', tx);
                //  console.log('--------------------------------------------------');
                //}

                let currenttxdetails = new TxDetail;
                if (tx.kind === 'Fee') {
                    currentTxList[0].fee = (currentTxList[0].fee ? currentTxList[0].fee : 0) + tx.amount / 10 ** 8;
                    if (currentTxList[0].txDetails.length === 0) {
                        // when only have 1 item with `Fee`, we assume this tx is `SendToSelf`.
                        currentTxList[0].type = 'SendToSelf';
                        currenttxdetails.address = '';
                        currenttxdetails.amount = 0;
                        currentTxList[0].txDetails.push(currenttxdetails);
                    }
                } else {
                    currenttxdetails.address = !tx.to_address || tx.to_address === 'None' ? '' : tx.to_address;
                    currenttxdetails.amount = tx.amount / 10 ** 8;
                    currenttxdetails.memos = !tx.memos ? undefined : tx.memos;
                    currenttxdetails.pool = !tx.pool || tx.pool === 'None' ? undefined : tx.pool;
                    currentTxList[0].txDetails.push(currenttxdetails);
                }

                //currentTxList[0].txDetails.forEach(det => console.log(det.memos));
                //console.log(currentTxList[0]);
                txList = [...currentTxList, ...restTxList];
            });
            // console.log("=== txList ===")
            // console.log(txList);

            // Now, combine the amounts and memos
            const combinedTxList = [];
            txList.forEach((txns) => {
                const combinedTx = txns;
                if (txns.type === 'Sent' || txns.type === 'SendToSelf') {
                    // using address for `Sent` & `SendToSelf`
                    combinedTx.txDetails = this.rpc_combineTxDetailsByAddress(txns.txDetails);
                } else {
                    // using pool for `Received`
                    combinedTx.txDetails = this.rpc_combineTxDetailsByPool(txns.txDetails);
                }

                //combinedTx.txDetails.forEach(det => console.log(det.memos));
                //console.log(combinedTx);
                combinedTxList.push(combinedTx);
            });
            //console.log(combinedTxList);
            this.transactionsList = combinedTxList;
            return summariesJSON;
        }

        catch(error) {
            console.log(`Critical Error txs list ${error}`);
            return;
        }
    }

    async fetchWalletSettings() {
        try {
            const download_memos_str = await native.zingolib_execute_async('getoption', 'download_memos');
            if (download_memos_str) {
                if (download_memos_str.toLowerCase().startsWith('error')) {
                    console.log(`Error download memos ${download_memos_str}`);
                    return;
                }
            } else {
                console.log('Internal Error download memos');
                return;
            }
            const download_memos_json = await JSON.parse(download_memos_str);
    
            const transaction_filter_threshold_str = await native.zingolib_execute_async(
                'getoption',
                'transaction_filter_threshold',
            );
            if (transaction_filter_threshold_str) {
                if (transaction_filter_threshold_str.toLowerCase().startsWith('error')) {
                    console.log(`Error transaction filter threshold ${transaction_filter_threshold_str}`);
                    return;
                }
            } else {
                console.log('Internal Error transaction filter threshold');
                return;
            }
            const transaction_filter_threshold_json = await JSON.parse(transaction_filter_threshold_str);
    
            const walletSettings = new WalletSettings();
            walletSettings.download_memos = download_memos_json.download_memos || '';
            walletSettings.transaction_filter_threshold =
            transaction_filter_threshold_json.transaction_filter_threshold || '';
    
            this.walletSettings = walletSettings;

        } catch (error) {
            console.log(`Critical Error transaction filter threshold ${error}`);
            return;
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
            const heightJSON = await JSON.parse(heightStr);
      
            this.lastWalletBlockHeight = heightJSON.height;
        }
        catch(error) {
            console.log(`Critical Error wallet height ${error}`);
            return;
        }
    }

    async fetchWalletBirthday() {
        const wallet = await this.rpc_fetchWallet(this.readOnly);

        if (wallet) {
            this.walletBirthday = wallet.birthday;
        }
    }

    async fetchInfoAndServerHeight() {
        const info = await this.rpc_getInfoObject();
    
        if (info) {            
            this.infoObject = info;
            this.lastServerBlockHeight = info.latestBlock;
        }
    }

    // Send a transaction using the already constructed sendJson structure
    async sendTransaction(sendJson) {
        this.inSend = true;

        // First, get the previous send progress id, so we know which ID to track
        const prev = await this.doSendProgress();
        let prevSendId = -1;
        if (prev && !prev.toLowerCase().startsWith('error')) {
            let prevProgress = {};
            try {
                prevProgress = await JSON.parse(prev);
                prevSendId = prevProgress.id;
            } catch (e) {}
        }

        //console.log('prev progress id', prevSendId);

        try {
            await native.zingolib_execute_async("send", JSON.stringify(sendJson));
        }
        catch(err) {
            console.log(err);
            throw err;
        }

        // The send command is async, so we need to poll to get the status
        const sendTxPromise = new Promise((resolve, reject) => {
            const intervalID = setInterval(async () => {
                const progressStr = await this.doSendProgress();
                const progress = JSON.parse(progressStr);

                if(progress.id === prevSendId) {
                    // Still not started, so wait for more time
                    console.log('waiting')
                    return;
                }

                this.inSend = progress.sending;

                if (!progress.txid && !progress.error) {
                    // Still processing                   
                    return;
                }

                // Finished processing
                clearInterval(intervalID);
                this.inSend = false;

                if(progress.txid && !progress.error) {
                    // And refresh data (full refresh)
                    this.refresh(true, false);
                    resolve(progress.txid);
                }

                else {
                    reject(progress.error);
                }
            }, 2 * 1000) // Every 2 seconds
        });

        return sendTxPromise;
    }

    async doSendProgress() {
        try {
            const sendProgressStr = await native.zingolib_execute_async('sendprogress', '');
            if (sendProgressStr) {
                if (sendProgressStr.toLowerCase().startsWith('error')) {
                    console.log(`Error send progress ${sendProgressStr}`);
                    return sendProgressStr;
                }
            } else {
                console.log('Internal Error send progress');
                return 'Error: Internal RPC Error: send progress';
            }
      
            return sendProgressStr;
        } catch (error) {
            console.log(`Critical Error send progress ${error}`);
            return `Error: ${error}`;
        }
    }

    async fetchAllAddresses() {
        try {
            const addressesStr = await native.zingolib_execute_async('addresses', '');
            if (addressesStr) {
                if (addressesStr.toLowerCase().startsWith('error')) {
                    console.log(`Error addresses ${addressesStr}`);
                    return;
                }
            } else {
                console.log('Internal Error addresses');
                return;
            }
            return JSON.parse(addressesStr);
        }
        catch(error) {
            console.log(`Critical Error addresses ${error}`);
            return;
        }
    }

    async fetchLastTxId() {
        const txListStr = await native.zingolib_execute_async("summaries", "");
        const txListJSON = JSON.parse(txListStr);

        // console.log('=============== get Last TX ID', txListJSON.length); 

        if (txListJSON && txListJSON.length && txListJSON.length > 0) {
            return txListJSON[txListJSON.length - 1].txid;
        }
        else {
            return "0";
        }
    }

    async getTransactionsList() {           
        // await this.refresh(true, false);     
        await this.fetchTandZandOTransactionsSummaries();
        return this.transactionsList;
    }

    async parseAddress(addr) {
        try {
            const res = await native.zingolib_execute_async("parse_address", addr);        
            const resJson = JSON.parse(res);
            return resJson;
        } 
        catch(err) {
            return null;
        }
    }

    getDefaultFee() {
        return this.infoObject.defaultFee || 0.00001;
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

        if (this.syncStatusTimerID) {
            clearInterval(this.syncStatusTimerID);
            this.syncStatusTimerID = undefined;
        }        
    }

    async deinitialize() {        
        console.log("Safely shutting down zingolib ...");
        this.clearTimers();
        await native.zingolib_execute_async('save','');
        native.zingolib_deinitialize();
        process.exit();
    }
    
}

module.exports = LiteWallet;