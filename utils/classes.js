class TxDetail {
    constructor() {
        this.address = "";
        this.amount = "";
        this.memo = null;
      }
}

class Transaction {
    constructor() {
        this.type = "";
        this.address = "";
        this.amount = 0;
        this.position = "";
        this.confirmations = 0;
        this.txid = "";
        this.time = 0;
        this.detailedTxns = [];
    }
}

class TotalBalance {
    constructor() {
        this.sapling_balance = 0;
        this.verified_sapling_balance = 0;
        this.spendable_sapling_balance = 0;
        this.unverified_sapling_balance = 0;
        this.orchard_balance = 0;
        this.verified_orchard_balance = 0;
        this.spendable_orchard_balance = 0;
        this.unverified_orchard_balance = 0;
        this.transparent_balance = 0;
        this.total = 0;
    }
}

class Address {
    constructor(address, receivers) {
        this.address = address;
        this.receivers = receivers;
    }
}

class AddressBalance {
    constructor(address, balance) {
        this.address = address;
        this.balance = balance;
        this.containsPending = false;
    }
}

class WalletSettings {
    constructor() {
        this.download_memos = "wallet";
        this.spam_filter_threshold = 0;
    }
}

class Info {
    constructor() {
        this.testnet = false;
        this.latestBlock = 0;
        this.connections = 0;
        this.version = "";
        this.zcashdVersion = "";
        this.verificationProgress = 0;
        this.currencyName = "";
        this.solps = 0;
        this.zecPrice = 0;
        this.encrypted = false;
        this.locked = false;
        this.walletHeight = 0;
    }
}



module.exports = {
    TxDetail,
    Transaction,
    TotalBalance,
    Address,
    AddressBalance,
    WalletSettings,
    Info
}