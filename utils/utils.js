const { EventEmitter } = require('events');
const { Buffer } = require('buffer');

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

    fromPaymentURI(uri) {

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

    getPaymentURI() {
        const memo64 = Buffer.from(this.memo, 'utf-8')
        .toString('base64')
        .replaceAll('=', '')
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        return `zcash:${this.recipient}?amount=${this.amount / 10**8}&memo=${memo64}`
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
        console.log("Listening for new payment ...")
        this.lastTxId = await this.client.fetchLastTxId();

        const timer = setInterval(async ()=> {
            const lastTx = await this.client.fetchLastTxId();                        
            if(lastTx !== this.lastTxId) {
                this.lastTxId = lastTx;                                           
                try {
                    const tx = await this.client.getTransactionsSummaries()
                    const txDetail = tx.transaction_summaries.filter((t) => t.txid === lastTx);
                    if(txDetail[0].kind === 'received') {                    
                        console.log("Detected a new payment")
                        this.emit('payment', txDetail[0]);
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
            
            if(lastTx == -1) {
                console.log("txid error")
            }
            else if(lastTx != this.lastTxId) {                
                const txList = [];
                try {
                    const tx = await this.client.getTransactionsSummaries();
                    const txDetail = tx.transaction_summaries.filter((t) => t.kind == 'received').reverse();
                    
                    if(txDetail.length > 0) {
                        for(var i = 0; i < txDetail.length; i ++) {                                                
                        //    console.log(txDetail[i].txid)
                            if(txDetail[i].txid == this.lastTxId) {
                                break;
                            }
                            
                            txList.push(txDetail[i]);
                        }         
                    }

                    if(txList.length > 0) {
                        console.log(`Detected ${txList.length} new payments`);                            
                        this.emit("payments", txList);
                    }
                } catch(err) { console.log(err) }  
                
                this.lastTxId = lastTx;              
            }
            else {
                // const tx = await this.client.getTransactionsSummaries();

                // const txDetail = tx.transaction_summaries.filter((t) => t.kind == 'received').reverse().flat();

                // // const txDetail = tx.transaction_summaries.reverse().flat();

                // console.log(this.lastTxId)
                // console.log(lastTx)
                // console.log(txDetail[0]);
            }
        }, interval);
    }

    setLastTxId(txid) {
        this.lastTx = txid;
    }
}

module.exports = {
    TxBuilder,
    PaymentDetect
}