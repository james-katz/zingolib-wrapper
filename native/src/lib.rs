use node_bindgen::derive::node_bindgen;

extern crate lazy_static;

use bip0039::Mnemonic;
use lazy_static::lazy_static;

use tokio::runtime::Runtime;
use zcash_address::ZcashAddress;
use zcash_protocol::{memo::MemoBytes, value::Zatoshis};
use zingolib::{config::{construct_lightwalletd_uri, ChainType, ZingoConfig}, data::{proposal::total_fee, receivers::{transaction_request_from_receivers, Receivers}, PollReport}, utils::conversion::txid_from_hex_encoded_str, wallet::{keys::unified::ReceiverSelection, LightWallet, WalletBase, WalletSettings}};
use zingolib::lightclient::LightClient;

use std::{fs::File, io::Write, sync::RwLock};

use pepper_sync::{config::{PerformanceLevel, SyncConfig, TransparentAddressDiscovery}, wallet::{OrchardNote, SaplingNote, SyncMode}};
use rustls::crypto::ring::default_provider;
use rustls::crypto::CryptoProvider;
use zcash_client_backend::{address::Address, keys::UnifiedFullViewingKey};
use zcash_primitives::{consensus::BlockHeight, zip32::AccountId};

use std::num::NonZeroU32;

// // We'll use a MUTEX to store a global lightclient instance,
// // so we don't have to keep creating it. We need to store it here, in rust
// // because we can't return such a complex structure back to JS
lazy_static! {
    static ref LIGHTCLIENT: RwLock<Option<LightClient>> = RwLock::new(None);
}

lazy_static! {
    pub static ref RT: Runtime = tokio::runtime::Runtime::new().unwrap();
}

fn store_client(lightclient: LightClient) {
    LIGHTCLIENT.write().unwrap().replace(lightclient);
}

#[node_bindgen]
fn say_hello() -> String {
    "Hello from Rust!".to_string()
}

fn construct_uri_load_config(
    uri: String,
    chain_hint: String
) -> Result<(ZingoConfig, http::Uri), String> {
    let lightwalletd_uri = construct_lightwalletd_uri(Some(uri));

    let chaintype = match chain_hint.as_str() {
        "main" => ChainType::Mainnet,
        "test" => ChainType::Testnet,
        // "regtest" => ChainType::Regtest(testutils::default_regtest_heights()),
        _ => return Err("Error: Not a valid chain hint!".to_string()),
    };
    let config = match zingolib::config::load_clientconfig(
        lightwalletd_uri.clone(),
        None,
        chaintype,
        WalletSettings {
            sync_config: SyncConfig {
                transparent_address_discovery: TransparentAddressDiscovery::minimal(),
                performance_level: PerformanceLevel::Medium
            },
            min_confirmations: NonZeroU32::try_from(3).unwrap(),
        },
        NonZeroU32::try_from(1).expect("hard-coded integer"),
        String::from("zingo-wallet.dat")
    ) {
        Ok(c) => c,
        Err(e) => {
            return Err(format!("Error: Config load: {}", e));
        }
    };
    
    Ok((config, lightwalletd_uri))
}

/// Check if there is an existing wallet
#[node_bindgen]
fn wallet_exists(server_uri: String, chain_hint: String) -> Result<bool, bool> {    
    let (config, _lightwalletd_uri);
    match construct_uri_load_config(server_uri, chain_hint) {
        Ok((c, h)) => (config, _lightwalletd_uri) = (c, h),
        Err(_) => return Err(false),
    };
   
    Ok(config.wallet_path_exists())
}

#[node_bindgen]
fn init_new(server_uri: String, chain_hint: String) -> Result<String, String> {    
    let (config, lightwalletd_uri) = match construct_uri_load_config(server_uri, chain_hint) {
        Ok(c) => c,
        Err(e) => return Err(format!("{e}")),
    };
    let latest_block_height = match RT
        .block_on(async move { zingolib::grpc_connector::get_latest_block(lightwalletd_uri).await })
    {
        Ok(block_id) => block_id.height,
        Err(e) => {
            return Err(format!("Error: {e}"));
        }
    };
    let lightclient = match LightClient::new(
        config,
        (latest_block_height.saturating_sub(100) as u32).into(),
        false,
    ) {
        Ok(l) => l,
        Err(e) => {
            return Err(format!("Error: {e}"));
        }
    };
    store_client(lightclient);

    Ok("Lightclient initialized from fresh entropy.".to_string())
}

/// Initialize a lightclient from mnemonic phrase
#[node_bindgen]
fn init_from_seed_phrase(server_uri: String, seed: String, birthday: i32, chain_hint: String) -> Result<String, String> {
    let (config, _lightwalletd_uri) = match construct_uri_load_config(server_uri, chain_hint) {
        Ok(c) => c,
        Err(e) => return Err(format!("{e}")),
    };
    
    let mnemonic = match Mnemonic::from_phrase(seed) {
        Ok(m) => m,
        Err(e) => {
            return Err(format!("Error: {e}"));
        }
    };
    let wallet = match LightWallet::new(
        config.chain,
        WalletBase::Mnemonic {
            mnemonic,
            no_of_accounts: config.no_of_accounts,
        },
        BlockHeight::from_u32(birthday as u32),
        config.wallet_settings.clone(),
    ) {
        Ok(w) => w,
        Err(e) => return Err(format!("Error: {e}")),
    };
    let lightclient = match LightClient::create_from_wallet(wallet, config, false) {
        Ok(l) => l,
        Err(e) => {
            return Err(format!("Error: {e}"));
        }
    };
    store_client(lightclient);

    Ok("Lightclient initialized from seed phrase.".to_string())
}

/// Initialize a lightclient from a UFVK
#[node_bindgen]
fn init_from_ufvk(server_uri: String, ufvk: String, birthday: i32, chain_hint: String) -> Result<String, String> {
    let (config, _lightwalletd_uri) = match construct_uri_load_config(server_uri, chain_hint) {
        Ok(c) => c,
        Err(e) => return Err(format!("{e}")),
    };

    let wallet = match LightWallet::new(
        config.chain,
        WalletBase::Ufvk(ufvk),
        BlockHeight::from_u32(birthday as u32),
        config.wallet_settings.clone(),
    ) {
        Ok(w) => w,
        Err(e) => return Err(format!("Error: {e}")),
    };

    let lightclient = match LightClient::create_from_wallet(wallet, config, false) {
        Ok(l) => l,
        Err(e) => {
            return Err(format!("Error: {e}"));
        }
    };

    store_client(lightclient);
    
    Ok("Lightclient initialized from UFVK.".to_string())
}

/// Initialize a lightclient from an existing wallet file 
#[node_bindgen]
fn init_from_disk(server_uri: String, chain_hint: String) -> Result<String, String> {    
    let (config, _lightwalletd_uri) = match construct_uri_load_config(server_uri, chain_hint) {
        Ok(c) => c,
        Err(e) => return Err(format!("Error: {}", e)),
    };

    println!("{:?}", config.clone().get_wallet_path());

    let lightclient = match LightClient::create_from_wallet_path(config) {
        Ok(w) => w,
        Err(e) => return Err(format!("{}", e)),
    };


    store_client(lightclient);

    Ok("Lightclient initialized from disk.".to_string())
}

#[node_bindgen]
fn save_wallet() -> Result<String, String> {
    // Get the wallet as a base64 encoded string
    // And save it to a wallet file
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {        
        RT.block_on(async move {
            match lightclient.wallet.write().await.save() {
                Ok(Some(wallet_bytes)) => {
                    let wallet_path = lightclient.config().get_wallet_path();

                    let mut file = match File::create(wallet_path) {
                        Ok(f) => f,
                        Err(e) => return Err(format!("Error: {}", e.to_string())),
                    };
                    // Try to write wallet_bytes to file
                    match file.write_all(&wallet_bytes) {
                        Ok(()) => Ok("Wallet file saved.".to_string()),
                        Err(e) => return Err(format!("Error {}", e.to_string())),
                    }                  
                },
                // TODO: check this is better than a custom error when save is not required (empty buffer)
                Ok(None) => Ok("No need to save the wallet file".to_string()),
                Err(e) => return Err(format!("Error: {}", e)),
            }
        })
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
fn save_wallet_task() -> Result<String, String> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        RT.block_on(async move {
            let _task = lightclient.save_task().await;
            Ok("Save task launched.".to_string())
        })                
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
fn get_latest_block_server(server_uri: String) -> Result<String, String> {
    let lightwalletd_uri = match server_uri.parse() {
        Ok(uri) => uri,
        Err(e) => {
            return Err(format!("Error: failed to parse uri. {e}"));
        }
    };
    let height = match RT
        .block_on(async move { zingolib::grpc_connector::get_latest_block(lightwalletd_uri).await })
    {
        Ok(block_id) => block_id.height.to_string(),
        Err(e) => return Err(format!("Error: {e}")),
    };

    Ok(height)
}

#[node_bindgen]
fn get_latest_block_wallet() -> Result<String, String> {
    if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
        let height = RT.block_on(async move {
            lightclient.wallet.read().await.sync_state.highest_scanned_height().map(u32::from).unwrap_or(0)
        });
        Ok(json::object! {"height" => height}.pretty(2))
    } else {
        return Err("Error: Lightclient is not initialized".to_string());
    }
}

#[node_bindgen]
fn last_txid() -> String {
if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
        RT.block_on(async move {
            let wallet = lightclient.wallet.read().await;
            match wallet.wallet_transactions
                .iter()
                .max_by_key(|(_, tx)| tx.datetime()) {
                    Some((txid, _)) => format!("{txid}"),
                    None => "Error: wallet_transactions is empty.".to_string(),
                }
        })        
    } else {
        return "Error: Lightclient is not initialized".to_string();
    }
}

#[node_bindgen]
fn get_notes(spent: bool) -> Result<String, String> {
    let all_notes = if spent {
        true
    } else {
        false
    };

    if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {        
        let notes = RT.block_on(async move {
            let wallet = lightclient.wallet.read().await;

            json::object! {
                "orchard_notes" => json::JsonValue::from(wallet.note_summaries::<OrchardNote>(all_notes)),
                "sapling_notes" => json::JsonValue::from(wallet.note_summaries::<SaplingNote>(all_notes)),
                "utxos" => json::JsonValue::from(wallet.coin_summaries(all_notes)),
            }
            .pretty(2)
        });

        Ok(notes)
    }
    else {
        return Err("Error: Lightclient is not initialized".to_string());
    }
}

#[node_bindgen]
fn get_balance() -> Result<String, String> {        
    if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
        RT.block_on(async move {
            match lightclient
                .account_balance(AccountId::ZERO)
                .await
            {
                Ok(bal) => Ok(json::JsonValue::from(bal).pretty(2)),
                Err(e) => return Err(format!("Error: {e}")),
            }            
        })
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
fn get_spendable_balance_total() -> Result<i64, String> {    
    if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
        RT.block_on(async move {
            let wallet = lightclient.wallet.write().await;
            match wallet.shielded_spendable_balance(AccountId::ZERO, false) {
                Ok(bal) => Ok(bal.into_u64() as i64),
                Err(e) => return Err(format!("Error {}", e)),
            }
        })
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
fn get_unified_addresses() -> Result<String, String> {
    if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
        RT.block_on(async move { Ok(lightclient.unified_addresses_json().await.pretty(2)) })
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
fn create_new_unified_address(receivers: String) -> Result<String, String> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        RT.block_on(async move {
            let mut wallet = lightclient.wallet.write().await;
            let network = wallet.network;
            let receivers_available = ReceiverSelection {
                orchard: receivers.contains('o'),
                sapling: receivers.contains('z'),
            };
            match wallet.generate_unified_address(receivers_available, AccountId::ZERO) {
                Ok((id, unified_address)) => {
                    Ok(
                        json::object! {
                            "account" => u32::from(AccountId::ZERO),
                            "address_index" => id.address_index,
                            "has_orchard" => unified_address.has_orchard(),
                            "has_sapling" => unified_address.has_sapling(),
                            "has_transparent" => unified_address.has_transparent(),
                            "encoded_address" => unified_address.encode(&network),
                        }.pretty(2)
                    )
                }
                Err(e) => return Err(format!("Error: {e}")),
            }
        })
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
fn parse_address(address: String) -> Result<String, String> {    
    if address.is_empty() {
        return Err("Error: The address is empty".to_string())
    } else {
        fn make_decoded_chain_pair(
            address: &str,
        ) -> Option<(zcash_client_backend::address::Address, ChainType)> {
            [
                ChainType::Mainnet,
                ChainType::Testnet,
                // ChainType::Regtest(testutils::default_regtest_heights()),
            ]
            .iter()
            .find_map(|chain| Address::decode(chain, address).zip(Some(*chain)))
        }
        if let Some((recipient_address, chain_name)) = make_decoded_chain_pair(&address) {
            let chain_name_string = match chain_name {
                ChainType::Mainnet => "main",
                ChainType::Testnet => "test",
                ChainType::Regtest(_) => "regtest",
            };
            let parsed = match recipient_address {
                Address::Sapling(_) => json::object! {
                    "status" => "success",
                    "chain_name" => chain_name_string,
                    "address_kind" => "sapling",
                }
                .pretty(2),
                Address::Transparent(_) => json::object! {
                    "status" => "success",
                    "chain_name" => chain_name_string,
                    "address_kind" => "transparent",
                }
                .pretty(2),
                Address::Tex(_) => json::object! {
                    "status" => "success",
                    "chain_name" => chain_name_string,
                    "address_kind" => "tex",
                }
                .pretty(2),
                Address::Unified(ua) => {
                    let mut receivers_available = vec![];
                    if ua.sapling().is_some() {
                        receivers_available.push("sapling")
                    }
                    if ua.transparent().is_some() {
                        receivers_available.push("transparent")
                    }
                    if ua.orchard().is_some() {
                        receivers_available.push("orchard");
                        json::object! {
                            "status" => "success",
                            "chain_name" => chain_name_string,
                            "address_kind" => "unified",
                            "receivers_available" => receivers_available,
                            "only_orchard_ua" => zcash_keys::address::UnifiedAddress::from_receivers(ua.orchard().cloned(), None, None).expect("To construct UA").encode(&chain_name),
                        }
                        .pretty(2)
                    } else {
                        json::object! {
                            "status" => "success",
                            "chain_name" => chain_name_string,
                            "address_kind" => "unified",
                            "receivers_available" => receivers_available,
                        }
                        .pretty(2)
                    }
                }
            };
            Ok(parsed)
        } else {
            Ok(json::object! {
                "status" => "Invalid address",
                "chain_name" => json::JsonValue::Null,
                "address_kind" => json::JsonValue::Null,
            }
            .pretty(2))
        }
    }
}

#[node_bindgen]
fn run_rescan() -> Result<String, String> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        RT.block_on(async move {
            match lightclient.rescan().await {
                Ok(_) => Ok("Launching rescan...".to_string()),
                Err(e) => return Err(format!("Error: {e}")),
            }
        })
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
fn run_sync() -> Result<String, String> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        if lightclient.sync_mode() == SyncMode::Paused {
            lightclient.resume_sync().expect("sync should be paused");
            Ok("Resuming sync task...".to_string())
        } else {
            RT.block_on(async move {
                match lightclient.sync().await {
                    Ok(_) => Ok("Launching sync task...".to_string()),
                    Err(e) => return Err(format!("Error: {e}")),
                }
            })
        }
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
fn pause_sync() -> Result<String, String> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        match lightclient.pause_sync() {
            Ok(_) => Ok("Pausing sync task...".to_string()),
            Err(e) => return Err(format!("Error: {e}")),
        }        
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
fn stop_sync() -> Result<String, String> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        match lightclient.stop_sync() {
            Ok(_) => Ok("Stopping sync task...".to_string()),
            Err(e) => return Err(format!("Error: {e}")),
        }
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
fn status_sync() -> Result<String, String> {
    if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
        RT.block_on(async move {
            match pepper_sync::sync_status(&*lightclient.wallet.read().await).await {
                Ok(status) => Ok(json::JsonValue::from(status).pretty(2)),
                Err(e) => return Err(format!("Error: {e}")),
            }
        })
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
fn poll_sync() -> Result<String, String> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        let poll_sync = match lightclient.poll_sync() {
            PollReport::NoHandle => "Sync task has not been launched.".to_string(),
            PollReport::NotReady => "Sync task is not complete.".to_string(),
            PollReport::Ready(result) => match result {
                Ok(sync_result) => {
                    json::object! { "sync_complete" => json::JsonValue::from(sync_result) }
                        .pretty(2)
                }
                Err(e) => return Err(format!("Error: {e}")),
            },
        };
        Ok(poll_sync)
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
async fn get_value_transfers_async() -> Result<String, String> {
    let wallet = {
        let guard = LIGHTCLIENT.read().map_err(|_| "Lock poisoned".to_string())?;
        let lc = guard.as_ref().ok_or_else(|| "Error: Lightclient is not initialized".to_string())?;
        lc.wallet.clone()
    };

    // RT.block_on(async  {
    //     println!("Sleeping");
    //     tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    //     println!("Waking up");
    // });
    
    let wallet_guard = wallet.read().await;
    match wallet_guard.value_transfers(true).await {
        Ok(vt)  => Ok(json::JsonValue::from(vt).pretty(2)),
        Err(e)  => Err(format!("Error: {e}")),
    }
}

#[node_bindgen]
fn get_seed() -> Result<String, String> {
    if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
        RT.block_on(async move {
            match lightclient.wallet.read().await.recovery_info() {
                Some(recovery_info) => Ok(serde_json::to_string_pretty(&recovery_info)
                    .unwrap_or_else(|_| "error: get seed. failed to serialize".to_string())),
                None => return Err("error: get seed. no mnemonic found. wallet loaded from key.".to_string()),
            }
        })
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
fn get_ufvk() -> Result<String, String> {
    if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
        RT.block_on(async move {
            let wallet = lightclient.wallet.read().await;
            let ufvk: UnifiedFullViewingKey = match wallet
                .unified_key_store
                .get(&AccountId::ZERO)
                .expect("account 0 must always exist")
                .try_into()
            {
                Ok(ufvk) => ufvk,
                Err(e) => {
                    return Err(format!("Error: {e}"));
                }
            };
            Ok(json::object! {
                "ufvk" => ufvk.encode(&wallet.network),
                "birthday" => u32::from(wallet.birthday)
            }
            .pretty(2))
        })
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
async fn send(send_json: String) -> Result<String, String> {    
    let json_args = match json::parse(&send_json) {
        Ok(parsed) => parsed,
        Err(_) => return Err("Error: it is not a valid JSON".to_string())
    };

    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        RT.block_on(async move {
            let mut receivers = Receivers::new();
            for j in json_args.members() {
                let recipient_address = match j["address"].as_str() {
                    Some(addr) => match ZcashAddress::try_from_encoded(addr) {
                        Ok(a) => a,
                        Err(e) => return Err(format!("Error: Invalid address: {e}")),
                    },
                    None => return Err("Error: Missing address".to_string()),
                };

                let amount = match j["amount"].as_u64() {
                    Some(a) => match Zatoshis::from_u64(a) {
                        Ok(a) => a,
                        Err(e) => return Err(format!("Error: Invalid amount: {e}")),
                    },
                    None => return Err("Missing amount".to_string()),
                };

                let memo = if let Some(m) = j["memo"].as_str() {
                    let memo_bytes = MemoBytes::from_bytes(&Vec::from(m.as_bytes()))
                        .map_err(|_| format!("Error creating output. Memo '{:?}' is too long", m));
                    Some(memo_bytes.unwrap())
                } else {
                    None
                };

                receivers.push(zingolib::data::receivers::Receiver {
                    recipient_address,
                    amount,
                    memo,
                });
            }

            let request = match transaction_request_from_receivers(receivers)
            {
                Ok(request) => request,
                Err(e) => return Err(format!("Error: Request Error: {e}")),
            };

            match lightclient
            .propose_send(request, AccountId::ZERO).await {
                Ok(proposal) => {
                    let fee = match total_fee(&proposal) {
                        Ok(fee) => fee,
                        Err(e) => return Err(json::object! { "error" => e.to_string() }.pretty(2)),
                    };
                    Ok(json::object! { "fee" => fee.into_u64() }.pretty(2))
                }
                Err(e) => {
                    Err(json::object! { "error" => e.to_string() }.pretty(2))
                }
            }
        })
    } else {
        Err("Error: Lightclient is not initialized".to_string())
    }            
}

#[node_bindgen]
fn confirm() -> Result<String, String> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        RT.block_on(async move {
            match lightclient
                .send_stored_proposal()
                .await 
            {
                Ok(txids) => {
                    Ok(json::object! { "txids" => txids.iter().map(|txid| txid.to_string()).collect::<Vec<_>>() }.pretty(2))
                }
                Err(e) => {
                    return Err(json::object! { "error" => e.to_string() }.pretty(2))
                }
            }
        })        
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

// #[node_bindgen]
// fn quick_send(mut cx: FunctionContext) -> JsResult<JsPromise> {
//     let send_json = cx.argument::<JsString>(0)?.value(&mut cx);
    
//     let json_args = match json::parse(&send_json) {
//         Ok(parsed) => parsed,
//         Err(_) => return cx.throw_error("Error: it is not a valid JSON")
//     };

//     let promise = cx.task(move || {
//         if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
//             RT.block_on(async move {
//                 let mut receivers = Receivers::new();
//                 for j in json_args.members() {
//                     let recipient_address = match j["address"].as_str() {
//                         Some(addr) => match ZcashAddress::try_from_encoded(addr) {
//                             Ok(a) => a,
//                             Err(e) => return Err(format!("Error: Invalid address: {e}")),
//                         },
//                         None => return Err("Error: Missing address".to_string()),
//                     };

//                     let amount = match j["amount"].as_u64() {
//                         Some(a) => match Zatoshis::from_u64(a) {
//                             Ok(a) => a,
//                             Err(e) => return Err(format!("Error: Invalid amount: {e}")),
//                         },
//                         None => return Err("Missing amount".to_string()),
//                     };

//                     let memo = if let Some(m) = j["memo"].as_str() {
//                         let memo_bytes = MemoBytes::from_bytes(&Vec::from(m.as_bytes()))
//                             .map_err(|_| format!("Error creating output. Memo '{:?}' is too long", m));
//                         Some(memo_bytes.unwrap())
//                     } else {
//                         None
//                     };

//                     receivers.push(zingolib::data::receivers::Receiver {
//                         recipient_address,
//                         amount,
//                         memo,
//                     });
//                 }

//                 let request = match transaction_request_from_receivers(receivers)
//                 {
//                     Ok(request) => request,
//                     Err(e) => return Err(format!("Error: Request Error: {e}")),
//                 };

//                 match lightclient
//                 .quick_send(request, AccountId::ZERO).await {
//                     Ok(txids) => Ok(json::object! { "txids" => txids.iter().map(|txid| txid.to_string()).collect::<Vec<_>>() }.pretty(2)),
//                     Err(e) => Err(format!("{e}")),
//                 }
//             })
//         } else {
//             Err("Error: Lightclient is not initialized".to_string())
//         }            
//     }).promise(|mut cx, resp| {
//         match resp {
//             Ok(txids) => Ok(cx.string(txids)),
//             Err(e) => return cx.throw_error(format!("{e}")),
//         }
//     });

//     Ok(promise)
// }

#[node_bindgen]
fn quick_shield() -> Result<String, String>{
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        RT.block_on(async move {
            match lightclient
                .quick_shield(AccountId::ZERO)
                .await {
                    Ok(txids) => Ok(json::object! { "txids" => txids.iter().map(|txid| txid.to_string()).collect::<Vec<_>>() }.pretty(2)),
                    Err(e) => return Err(format!("{}", json::object! { "error" => e.to_string() })),
                }
        })        
    } else {
        return Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
pub fn remove_transaction(txid: String) -> Result<String, String> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        let txid = match txid_from_hex_encoded_str(&txid) {
            Ok(txid) => txid,
            Err(e) => return Err(format!("Error: {e}")),
        };

        RT.block_on(async move {
            match lightclient
                .wallet
                .write()
                .await
                .remove_unconfirmed_transaction(txid) {
                Ok(_) => Ok("Successfully removed transaction.".to_string()),
                Err(e) => Err(format!("Error: {e}")),
            }
        })
    } else {
        Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
pub fn resend_transaction(txid: String) -> Result<String, String> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        let txid = match txid_from_hex_encoded_str(&txid) {
            Ok(txid) => txid,
            Err(e) => return Err(format!("Error: {e}")),
        };

        RT.block_on(async move {
            match lightclient.resend(txid).await {
                Ok(_) => Ok("Successfully resent transaction.".to_string()),
                Err(e) => Err(format!("Error: {e}")),
            }
        })
    } else {
        Err("Error: Lightclient is not initialized".to_string())
    }
}

#[node_bindgen]
fn set_crypto_default_provider_to_ring() -> Result<String, String> {
    let resp: String;
    {
        if CryptoProvider::get_default().is_none() {
            resp = match default_provider()
                .install_default()
                .map_err(|_| "Error: Failed to install crypto provider".to_string())
            {
                Ok(_) => "true".to_string(),
                Err(e) => e,
            };
        } else {
            resp = "true".to_string();
        };
    }

    Ok(resp)
}