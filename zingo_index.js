const Litewallet = require('./zingo_litewallet');
// const { TxBuilder, PaymentDetect } = require('./utils/utils');

const client = new Litewallet("https://lwd6.zcash-infra.com:9067", "main", false);

client.init().then(async ()=> {
    console.log("\n\n\n==============\n\n\n")
    // Fetch wallet balance
    const bal = await client.fetchTotalBalance();
    console.log("Balance: ", bal);

    // Get all addresses
    const addrs = await client.fetchAllAddresses();;
    console.log(addrs);
    
    // Get last txid
    // const txid = await client.fetchLastTxId();
    // console.log(txid);

    // Get last transaction details
    // const tx = await client.getTransactionsList();
    // const lastTx = tx.filter((t) => t.txid === txid);
    // console.log(lastTx[0]);

    //Get all transactions
    const txns = await client.getTransactionsList();
    console.log(txns);

    client.deinitialize();        
}).catch((err) => {console.log(err)});
