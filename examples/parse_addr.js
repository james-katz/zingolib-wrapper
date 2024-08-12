const Litewallet = require('../zingolib');

const client = new Litewallet("https://zec.rocks:443", "main");

client.init().then(async ()=> {   
    let addr = await client.parseAddress("u12263wg70fvfenrmlyu79tf6zrmvl7dez8spava74v6glwkkzkgkwvjs5pzh7sf0nv0xy26juuc7gqd3d444vwvn64768vhj8lystumugrd54lx8a0y5rsudpgau7gmfwfvpuqx07t6as98lqt4xtfgnpzrat29m8qq6x3h2mg44enqztd2mmyvlqr500dyua8270v94hykuk5jhhcey");
    // addr = await client.parseAddress("zs1th7l7vk07a4e0ddh8ueglntk8940ej8vcp7ucuy3t77cpslkvvujlvqjjd6svdhxnxve7n62yes");
    // let addr = await client.parseAddress("u1q7d57jnpytvwpeuzn94dpxz66fpsdyzgdmm2ffezadux82qyar382kt2uz5s06eetlcjjaqcqutvkeder23vpvwysjpw5xpkjfv9gwt6hg8k33dhxt6jhj6wyrgadhpnffl3l6fjzzfjp4gk7653xtxn9amlcrhlff3k0e26zz2cp229y2flp50jhq3vnf6p2vxhg2j32e0lq36d5vv");
    console.log(addr);

    client.deinitialize();
}).catch((err) => console.log(err));
