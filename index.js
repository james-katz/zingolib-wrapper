const Litewallet = require('./litewallet');
const { TxBuilder, PaymentDetect } = require('./utils/utils');

const client = new Litewallet("https://mainnet.lightwalletd.com:9067/");

client.init().then(()=> {
    const bal = client.fetchAddressesWithBalance();
    console.log(bal);
    client.deinitialize();    
    
}).catch((err) => {console.log(err)});
