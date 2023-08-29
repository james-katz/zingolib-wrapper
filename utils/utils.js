const { EventEmitter } = require('events');

class TxBuilder {
    constructor() {
        this.recipient = "";
        this.amount = 0;
        this.memo = "";
        this.sendMany = [];
    }

    setAmount(amount) {
        this.amount = parseInt(amount * 10**8);
        return this;
    }

    setRecipient(address) {
        this.recipient = address;
        return this;
    }

    setRecipients(sendManyJson) {
        this.sendMany.push(sendManyJson);
        return this;
    }

    setMemo(memo) {
        this.memo = memo;
        return this;
    }

    getSendJSON() {                  
        let sendJSON = [];

        if(this.memo.length <= 512) {
            if(this.memo === "") this.memo = undefined;
            sendJSON = [{
                address: this.recipient,
                amount: this.amount,
                memo: this.memo
            }];
        }        
        else {
            // If the memo is more than 512 bytes, then we split it into multiple transactions.
            // Each memo will be `(xx/yy)memo_part`. The prefix "(xx/yy)" is 7 bytes long, so
            // we'll split the memo into 512-7 = 505 bytes length
            const splits = this.utf16Split(this.memo, 505);
            const tos = [];

            // The first one contains all the tx value
            tos.push({ address: this.recipient, amount: this.amount, memo: `(1/${splits.length})${splits[0]}`});

            for (let i = 1; i < splits.length; i++) {
                tos.push({ address: this.recipient, amount: 0, memo: `(${i + 1}/${splits.length})${splits[i]}`});
            }

            sendJSON = tos;
        }
                
        return sendJSON;
    }

    getSendManyJSON() {
        const sendJSON = [];
        this.sendMany.forEach((t) => {
            this.recipient = t.address;
            this.amount = t.amount;
            this.memo = t.memo;
            sendJSON.push(this.getSendJSON());
        });

        this.recipient = "";
        this.amount = 0;
        this.memo = "";
        
        return sendJSON.flat();
    }

    utf16Split(s, chunksize) {
        const ans = [];
    
        let current = "";
        let currentLen = 0;
        const a = [...s];
        for (let i = 0; i < a.length; i++) {
            // Each UTF-16 char will take upto 4 bytes when encoded
            const utf8len = a[i].length > 1 ? 4 : 1;
    
            // Test if adding it will exceed the size
            if (currentLen + utf8len > chunksize) {
                ans.push(current);
                current = "";
                currentLen = 0;
            }
    
            current += a[i];
            currentLen += utf8len;
        }
    
        if (currentLen > 0) {
            ans.push(current);
        }
    
        return ans;
      }
}

class PaymentDetect extends EventEmitter {
    constructor(client) {
        super();

        this.lastTxId = "";
        this.client = client;        
    }

    async detectSimple(interval) {
        this.lastTxId = await this.client.fetchLastTxId();

        const timer = setInterval(async ()=> {
            const lastTx = await this.client.fetchLastTxId();            
            if(lastTx !== this.lastTxId) {
                this.lastTxId = lastTx;                                           
                try {
                    const tx = await this.client.getTransactionsList().filter((t) => t.txid === lastTx );                
                    if(tx[0].type === 'receive') {                    
                        console.log("Detected a new payment")
                        this.emit('payment', tx[0]);
                    }
                } catch(err) { console.log(err) }
            }
        }, interval);
    }

    async detectList(interval) {
        console.log("Listening for new payments ...")
        this.lastTxId = await this.client.fetchLastTxId();

        const timer = setInterval(async ()=> {
            const lastTx = await this.client.fetchLastTxId();  

            if(lastTx !== this.lastTxId) {                
                const txList = [];
                try {
                    const tx = await this.client.getTransactionsList().filter((t) => t.type === 'receive');                                        
                    for(var i = 0; i < tx.length; i ++) {                                                
                        if(tx[i].txid === this.lastTxId) {
                            console.log(`Detected ${i} new payments`);                            
                            break;
                        }
                        
                        txList.push(tx[i]);
                    }                    
                    if(txList.length > 0) this.emit("payments", txList);
                } catch(err) { console.log(err) }  
                
                this.lastTxId = lastTx;              
            }
        }, interval);
    }
}

module.exports = {
    TxBuilder,
    PaymentDetect
}