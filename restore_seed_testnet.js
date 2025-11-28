const ZingoLib = require('./zingolib');

const client = new ZingoLib("https://testnet.zec.rocks:443", "test");

client.restore("surround square steel ice club jacket rude zebra awful torch drive guide property level wheel spoon foam oxygen female plug you curve observe vocal", 2789462).then(async (res) => {
    console.log(res);
    client.doSaveWallet();
})
.catch((err) => { console.log(err) });
