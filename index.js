const Litewallet = require('./litewallet');
// const { TxBuilder, PaymentDetect } = require('./utils/utils');

const client = new Litewallet("https://mainnet.lightwalletd.com:9067/", "main");

client.init().then(async ()=> {
    console.log("\n\n\n==============\n\n\n")
    // Fetch wallet balance
    const bal = await client.fetchTotalBalance();
    console.log(bal);

    // Get all addresses
    const addrs = await client.fetchAllAddresses();
    console.log(addrs);

    // Get addresses with balance
    const addrsbal = await client.fetchAddressesWithBalance();
    console.log(addrsbal);

    // Get sync status
    const syncStatus = await client.getSyncStatus();
    console.log(syncStatus.in_progress);

    // Get last txid
    const txid = await client.fetchLastTxId();
    console.log(txid);

    // Get last transaction details
    const tx = await client.getTransactionsList();
    const lastTx = tx.filter((t) => t.txid === txid);
    console.log(lastTx[0].type);
    
    // const s = await client.getTransactionsList();
    // s.forEach((el) => {
    //     console.log(el);
    // })

    client.deinitialize();        
}).catch((err) => {console.log(err)});
