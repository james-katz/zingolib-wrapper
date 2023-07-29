const Litewallet = require('./litewallet');
const { TxBuilder, PaymentDetect } = require('./utils/utils');

const client = new Litewallet("https://mainnet.lightwalletd.com:9067/");

client.init().then(async ()=> {    
       
        
    client.deinitialize();    
}).catch((err) => {console.log(err)});