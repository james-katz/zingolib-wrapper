const Litewallet = require('../zingolib');
const { PaymentDetect } = require('../utils/utils');

const client = new Litewallet("https://zec.rocks:443", 'main');

client.init().then(()=> {
    const pd = new PaymentDetect(client);
    console.log("ready")
    // Detect only last deposit to wallet every 5000 ms
    //pd.detectSimple(2000);

    // Get latest deposit
    //pd.on('payment', (tx) => {
    //    console.log(tx);
    //});

    // Detect a list of recent deposits to wallet every 20 seconds (20 * 1000 ms)
    pd.detectList(2 * 1000);

    // Get a list of latest deposits
    pd.on("payments", (txs) => {
        console.log(txs);
        // console.log(txs[0].orchard_notes)
    });
});

process.on("SIGINT", () => {
    client.deinitialize();
})
