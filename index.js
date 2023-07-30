const Litewallet = require('./litewallet');
const { TxBuilder, PaymentDetect } = require('./utils/utils');

const client = new Litewallet("https://mainnet.lightwalletd.com:9067/");

client.restore("discover quit still female argue reason differ day hungry security slot focus language congress audit this pool post dynamic soon slam almost exclude valve", 2173752, true)
.then(() => {
    client.init().then(()=> {
        const bal = client.fetchTotalBalance();
        console.log(bal)       ;
            
        client.deinitialize();    
    }).catch((err) => {console.log(err)});
}).catch((err) => {console.log(err)})
