const Litewallet = require('./litewallet');
const { TxBuilder, PaymentDetect } = require('./utils/utils');

const client = new Litewallet("https://mainnet.lightwalletd.com:9067/");

client.init().then(()=> {
    const tx = new TxBuilder()
        .setRecipient("u1z8v3gyl9c4lnlnljsrkpp85w8mq9887r80u2v845j0pcqrhfve5ufvharywekauq0qdt3fwvnxcutajqxs4k374v6fja0pw8hsyw0jjv")
        .setAmount(0.0007)
        .setMemo("Hello");
    client.sendTransaction(tx.getSendJSON()).then((txid) => {
        console.log(txid);
        client.deinitialize();    
    })    
}).catch((err) => {console.log(err)});
