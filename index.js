const ZingoLib = require('./zingolib');
// const { TxBuilder, PaymentDetect } = require('./utils/utils');

const client = new ZingoLib("https://zec.rocks:443", "main", true);

client.init().then(async (res)=> {
    console.log(res);
    console.log("==============")
    // Fetch wallet balance
    const bal = await client.fetchTotalBalance();
    console.log("Balance: ", bal);

    // Get default fee
    const fee = await client.getDefaultFee();
    console.log("Default fee: ", fee);

    // Get all addresses
     const addrs = await client.fetchAllAddresses();;
     console.log(addrs);

    // Get addresses with balance
    // const addrsB = await client.getAddressesWithBalance();;
    // console.log(addrsB);

    // Create new address
    // const newAddr = await client.createNewAddress();
    // console.log(newAddr)

    // Get notes
    // const notes = await client.fetchNotes();
    // console.log(notes);
    
    // Get last txid
     const txid = client.fetchLastTxId();
    // console.log(txid);

    // Get last transaction details (uncomment previous txid line)
      const tx = client.getTransactionsSummaries();    
      const lastTx = tx.transaction_summaries.filter((t) => t.txid === txid);
      console.log(lastTx[0]);

    //  const txAddrVal = await client.getAddressAndValueFromTx({txid: txid})
    //  console.log(txAddrVal)
     

    //Get all transactions
    // const txns = client.getTransactions();
	
    // const r = txns.value_transfers.filter((t) => t.kind == 'received');
    // for(const rx of r ) {
    //     const rAddr = await client.getAddressAndValueFromTx(rx);    
    //     if(rAddr && rAddr.length > 0) console.log(rAddr);
    // }
    
    // Get the wallet seed
     const seed = await client.getWalletSeed();
     console.log(seed);

    // Get the wallet ufvk
     const ufvk = await client.getWalletUfvk();    
     console.log(ufvk);

    // client.deinitialize();
}).catch((err) => {console.log(err)});
