const Litewallet = require('../zingolib');

const client = new Litewallet("https://zec.rocks:443", "main", false);

client.init().then(async ()=> {   
    let addr = client.parseAddress("u1x3vsk4l5nhc930g2g6dcjrpv834k8zrs5rymz3l0nlcm9mu25erjxth46atkm4s8ztn3v02vcjuw00c53c8drp90jlz22vt5y03yu0v4dlzlexrwxdfnd3qnaelypgnm7cq2eturugakqy0p52mwldhyyj820s9a9xf438uudpr9dulmsv8ycnfc8vvt2kx9y5s4wulxyqc2qh64a44");
    // addr = client.parseAddress("zs1th7l7vk07a4e0ddh8ueglntk8940ej8vcp7ucuy3t77cpslkvvujlvqjjd6svdhxnxve7n62yes");
    // let addr = client.parseAddress("u1q7d57jnpytvwpeuzn94dpxz66fpsdyzgdmm2ffezadux82qyar382kt2uz5s06eetlcjjaqcqutvkeder23vpvwysjpw5xpkjfv9gwt6hg8k33dhxt6jhj6wyrgadhpnffl3l6fjzzfjp4gk7653xtxn9amlcrhlff3k0e26zz2cp229y2flp50jhq3vnf6p2vxhg2j32e0lq36d5vv");
    console.log(addr)

    // let addr_decoded = client.decodeAddress("u1x3vsk4l5nhc930g2g6dcjrpv834k8zrs5rymz3l0nlcm9mu25erjxth46atkm4s8ztn3v02vcjuw00c53c8drp90jlz22vt5y03yu0v4dlzlexrwxdfnd3qnaelypgnm7cq2eturugakqy0p52mwldhyyj820s9a9xf438uudpr9dulmsv8ycnfc8vvt2kx9y5s4wulxyqc2qh64a44");
    // console.log(addr_decoded);

    client.deinitialize();
}).catch((err) => console.log(err));
