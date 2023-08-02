const Litewallet = require('./litewallet');
const { TxBuilder, PaymentDetect } = require('./utils/utils');

const client = new Litewallet("https://mainnet.lightwalletd.com:9067/");

client.init().then(()=> {
    // Fetch wallet balance
    const bal = client.fetchTotalBalance();
    console.log(bal);

    // Get all addresses
    const addrs = client.fetchAllAddresses();
    console.log(addrs);

    // Get addresses with balance
    const addrsbal = client.fetchAddressesWithBalance();
    console.log(addrsbal);

    client.deinitialize();        
}).catch((err) => {console.log(err)});
