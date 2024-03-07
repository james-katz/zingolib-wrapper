class TxDetail {
    constructor() {
        this.address = "";
        this.amount = "";
        this.memos = null;
        this.pool = "";
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
        this.orchardBal = 0;
        this.privateBal = 0;
        this.transparentBal = 0;
        this.spendableOrchard = 0;
        this.spendablePrivate = 0;
        this.total = 0;
    }
}

class Address {
    constructor(uaAddress, address, addressKind, receivers) {
        this.uaAddress = uaAddress;
        this.address = address;
        this.addressKind = addressKind;
        this.receivers = receivers;
        this.containsPending = false;  
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
        this.chain_name = "";
        this.latestBlock = 0;
        this.serverUri = "";
        this.connections = 0;
        this.version = "0";
        this.verificationProgress = 0;
        this.currencyName = "";
        this.solps = 0;
        this.defaultFee = 0;
        this.zingolib = "";        
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