const Litewallet = require('../zingolib');
const { TxBuilder } = require('../utils/utils');

const client = new Litewallet("https://zec.rocks:443/", "main");

client.init().then(async ()=> {
    // Check if wallet has spend
    const amount = 0.0005;
    const bal = await client.fetchTotalBalance();
    console.log(bal);
    if(bal > amount) {
        // Construct a basic transaction
        const tx = new TxBuilder()
            .setRecipient("u1q56zdmseafz50v22vrxjmamsg0r0ju0xqph308nms9qpz60nf7fl928jjnx3r45nn0fntthmvxc9ql7aldqj5zqgw067w3x9t26pdrkezlv77t2pptjcjhc2xzpwzd20spmn2w2vfgyywezed6g9wjp6yk36gjmmkxdwk47g2cxwf4h8")
            .setAmount(amount)
            .setMemo("Hello World, James Katz rules");

        // Get the sendjson
        const sendJson = tx.getSendJSON();
        console.log(sendJson);
        const uri = tx.getPaymentURI();
        console.log(uri)
        
        client.sendTransaction(sendJson).then((txid) => {
            console.log(txid);
            client.deinitialize();    
        }).catch((err) => { console.log(err) });
    }
    else {
        console.log("Not enough bals");
        client.deinitialize();
    }

    // client.deinitialize();
});
