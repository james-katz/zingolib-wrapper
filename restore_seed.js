const ZingoLib = require('./zingolib');

const client = new ZingoLib("https://zec.rocks:443", "main");

client.restore("powder layer oblige amused shed just cushion tent crystal blast catch bundle gym tortoise razor surprise quality awesome planet kangaroo shrimp age pluck crew", 2526004).then(res => {
    console.log(res);
})
.catch((err) => { console.log(err) });
