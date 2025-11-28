const ZingoLib = require('./zingolib');

const client = new ZingoLib("https://testnet.zec.rocks:443", "test");
let start;

client.init().then(async (res)=> {
    console.log(res);
    console.log("==============");
    
    // Do NOT uncomment
    // client.doRescan();
    
    // Get wallet height
    const walletHeight = client.fetchWalletHeight();
    const serverHeight = client.fetchServerHeight();
    console.log(`Wallet height: ${walletHeight} | Server height: ${serverHeight}`);

    // Fetch wallet balance
    const walletBal = client.fetchWalletBalance();
    console.log("Balance: ", walletBal);
    
    const spendableBal = client.totalSpendableBalance;
    console.log("Spendable balance: ", spendableBal);
    
    // Get all addresses
    //const addrs = client.fetchAllAddresses();
    //console.log(addrs);

    // Get addresses with balance
    // const addrsB = await client.getAddressesWithBalance();
    // console.log(addrsB);

    // Create new address
     const newAddr = await client.createNewAddress();
     console.log(newAddr)
    

    // Parse address info
    // let addr = client.parseAddress("u1x3vsk4l5nhc930g2g6dcjrpv834k8zrs5rymz3l0nlcm9mu25erjxth46atkm4s8ztn3v02vcjuw00c53c8drp90jlz22vt5y03yu0v4dlzlexrwxdfnd3qnaelypgnm7cq2eturugakqy0p52mwldhyyj820s9a9xf438uudpr9dulmsv8ycnfc8vvt2kx9y5s4wulxyqc2qh64a44");
    // console.log(addr);

    // Get notes
    const notes = client.fetchNotes();    
    console.log(notes.orchard_notes.note_summaries[0]);
    
    // Get last txid
    const txid = client.fetchLastTxId();
    console.log(txid);

    // Get last transaction details (uncomment previous txid line)
    // const tx = await client.getTransactions();    
    // const lastTx = tx.value_transfers.filter((t) => t.txid === txid);
    // console.log(lastTx[0]);
    
    // const txAddrVal = await client.getAddressAndValueFromTx({txid: txid})
    // console.log(txAddrVal)
     
    //Get all transactions
   
    client.getTransactionsPromise().then(txns => {
      // console.log(txns);
      
      // And filter by tx kind (uncomment previous txns line)
      const r = txns.value_transfers.filter((t) => t.kind == 'received');
      
      // Remove uncofnirmed transactionns (tx kind must be "sent")
      // const unconfirmed = r.filter((t) => t.status == 'calculated');
      // for(const tx of unconfirmed) {
      //   client.removeTransaction(tx.txid);
      // }

      let txCount = 0;
      for(const rx of r) {
          // console.log(rx);
          txCount ++;
          if(txCount >= 3) break;
      }      
    });

    // Get the wallet seed
    const seed = await client.getWalletSeed();
    console.log(seed);

    // Get the wallet ufvk
    // const ufvk = await client.getWalletUfvk();    
    // console.log(ufvk);

    // client.shieldTransparent();

    // fetch totalbalance multiple times
    setInterval(() => {
      const bal = client.totalSpendableBalance;
      console.log("Spendable balance: ", bal);
    }, 15*1000);

    // client.deinitialize();
  
}).catch((err) => {console.log(err)});

function startTimer() {
  start = process.hrtime.bigint();
}

function endTimer() {
  const end = process.hrtime.bigint();
  const durationMs = Number(end - start) / 1_000_000_000; // ns → s
  console.log(`Elapsed time: ${durationMs.toFixed(3)} s`);
  return durationMs;
}
