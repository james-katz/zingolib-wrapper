const ZingoLib = require('./zingolib');
// const { TxBuilder, PaymentDetect } = require('./utils/utils');

const client = new ZingoLib("https://lwd6.zcash-infra.com:9067", "main");

client.init().then(async (res)=> {
    console.log(res);
    console.log("\n\n\n==============\n\n\n")
    // Fetch wallet balance
    const bal = await client.fetchTotalBalance();
    console.log("Balance: ", bal);

    // Get default fee
    const fee = await client.getDefaultFee();
    console.log("Default fee: ", fee);

    // Get all addresses
    const addrs = await client.fetchAllAddresses();;
    // console.log(addrs);

    // Get addresses with balance
    // const addrsB = await client.getAddressesWithBalance();;
    // console.log(addrsB);

    // Get notes
    // const notes = await client.fetchNotes()
    // console.log(notes);
    
    // Get last txid
    const txid = await client.fetchLastTxId();
    console.log(txid);

    // Get last transaction details (uncomment previous txid line)
    const tx = await client.getTransactionsSummaries();    
    console.log(tx.transaction_summaries);
    // const lastTx = tx.transaction_summaries.filter((t) => t.txid === txid);
    // console.log(lastTx[0]);

    //Get all transactions
    // const txns = await client.getTransactionsSummaries();    
    // console.log(txns);

    // Get the wallet seed
    const seed = await client.getWalletUfvk();    
    // console.log(seed);

    client.deinitialize();        
}).catch((err) => {console.log(err)});
