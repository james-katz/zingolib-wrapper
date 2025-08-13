// #[macro_use]
extern crate lazy_static;

use bip0039::Mnemonic;
use lazy_static::lazy_static;

use neon::prelude::*;
use structs::NeonAccountBalance;
use tokio::runtime::Runtime;
use zcash_address::ZcashAddress;
use zcash_protocol::{memo::MemoBytes, value::Zatoshis};
use zingolib::{config::{construct_lightwalletd_uri, ChainType, ZingoConfig}, data::{proposal::total_fee, receivers::{transaction_request_from_receivers, Receivers}, PollReport}, lightclient, wallet::{keys::unified::ReceiverSelection, LightWallet, WalletBase, WalletSettings}};
use zingolib::lightclient::LightClient;
use zingo_infra_services::network::ActivationHeights;

use std::{fs::File, io::Write, sync::{Arc, RwLock}, thread};

use pepper_sync::{config::{PerformanceLevel, SyncConfig, TransparentAddressDiscovery}, wallet::{OrchardNote, SaplingNote, SyncMode}};
use rustls::crypto::ring::default_provider;
use rustls::crypto::CryptoProvider;
use zcash_client_backend::{address::{Address, UnifiedAddress}, keys::UnifiedFullViewingKey};
use zcash_client_backend::encoding::{AddressCodec, encode_payment_address};
use zcash_primitives::{consensus::{BlockHeight, MainNetwork}, zip32::AccountId};
use zcash_primitives::constants::mainnet::HRP_SAPLING_PAYMENT_ADDRESS;

use std::num::NonZeroU32;

mod structs;

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

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("sayHello", say_hello)?;
    cx.export_function("zingolib_wallet_exists", wallet_exists)?;
    cx.export_function("zingolib_init_new", init_new)?;
    cx.export_function("zingolib_init_from_seed_phrase", init_from_seed_phrase)?;
    cx.export_function("zingolib_init_from_ufvk", init_from_ufvk)?;
    cx.export_function("zingolib_init_from_disk", init_from_disk)?;
    cx.export_function("zingolib_save_wallet", save_wallet)?;
    cx.export_function("zingolib_save_wallet_task", save_wallet_task)?;
    cx.export_function("zingolib_get_latest_block_server", get_latest_block_server)?;
    cx.export_function("zingolib_get_latest_block_wallet", get_latest_block_wallet)?;
    cx.export_function("zingolib_get_notes", get_notes)?;
    cx.export_function("zingolib_get_balance", get_balance)?;
    cx.export_function("zingolib_get_spendable_balance_total", get_spendable_balance_total)?;
    cx.export_function("zingolib_get_unified_addresses", get_unified_addresses)?;
    cx.export_function("zingolib_create_new_unified_address", create_new_unified_address)?;
    cx.export_function("zingolib_parse_address", parse_address)?;
    cx.export_function("zingolib_run_rescan", run_rescan)?;
    cx.export_function("zingolib_run_sync", run_sync)?;
    cx.export_function("zingolib_pause_sync", pause_sync)?;
    cx.export_function("zingolib_stop_sync", stop_sync)?;
    cx.export_function("zingolib_status_sync", status_sync)?;
    cx.export_function("zingolib_poll_sync", poll_sync)?;
    cx.export_function("zingolib_get_value_transfers", get_value_transfers)?;
    cx.export_function("zingolib_get_seed", get_seed)?;
    cx.export_function("zingolib_get_ufvk", get_ufvk)?;
    cx.export_function("zingolib_send", send)?;
    cx.export_function("zingolib_confirm", confirm)?;
    cx.export_function("zingolib_quick_shield", quick_shield)?;    
    cx.export_function("zingolib_set_crypto_default_provider_to_ring", set_crypto_default_provider_to_ring)?;
    
    Ok(())
}

fn say_hello(mut cx: FunctionContext) -> JsResult<JsString> {
    Ok(cx.string("Hello from Rust!".to_string()))
}

fn construct_uri_load_config(
    uri: String,
    chain_hint: String
) -> Result<(ZingoConfig, http::Uri), String> {
    let lightwalletd_uri = construct_lightwalletd_uri(Some(uri));

    let chaintype = match chain_hint.as_str() {
        "main" => ChainType::Mainnet,
        "test" => ChainType::Testnet,
        "regtest" => ChainType::Regtest(ActivationHeights::default()),
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
        NonZeroU32::try_from(1).expect("hard-coded integer")
    ) {
        Ok(c) => c,
        Err(e) => {
            return Err(format!("Error: Config load: {}", e));
        }
    };
    
    Ok((config, lightwalletd_uri))
}

/// Check if there is an existing wallet
fn wallet_exists(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let server_uri = cx.argument::<JsString>(0)?.value(&mut cx);
    let chain_hint = cx.argument::<JsString>(1)?.value(&mut cx);
    
    let (config, _lightwalletd_uri);
    match construct_uri_load_config(server_uri, chain_hint) {
        Ok((c, h)) => (config, _lightwalletd_uri) = (c, h),
        Err(_) => return Ok(cx.boolean(false)),
    };
   
    Ok(cx.boolean(config.wallet_path_exists()))
}

fn init_new(mut cx: FunctionContext) -> JsResult<JsString> {
    let server_uri = cx.argument::<JsString>(0)?.value(&mut cx);
    let chain_hint = cx.argument::<JsString>(1)?.value(&mut cx);
    
    let (config, lightwalletd_uri) = match construct_uri_load_config(server_uri, chain_hint) {
        Ok(c) => c,
        Err(e) => return cx.throw_error(format!("{e}")),
    };
    let latest_block_height = match RT
        .block_on(async move { zingolib::grpc_connector::get_latest_block(lightwalletd_uri).await })
    {
        Ok(block_id) => block_id.height,
        Err(e) => {
            return cx.throw_error(format!("Error: {e}"));
        }
    };
    let lightclient = match LightClient::new(
        config,
        (latest_block_height.saturating_sub(100) as u32).into(),
        false,
    ) {
        Ok(l) => l,
        Err(e) => {
            return cx.throw_error(format!("Error: {e}"));
        }
    };
    store_client(lightclient);

    Ok(cx.string("Lightclient initialized from fresh entropy."))
}

/// Initialize a lightclient from mnemonic phrase
fn init_from_seed_phrase(mut cx: FunctionContext) -> JsResult<JsString> {
    let server_uri = cx.argument::<JsString>(0)?.value(&mut cx);
    let seed = cx.argument::<JsString>(1)?.value(&mut cx);
    let birthday = cx.argument::<JsNumber>(2)?.value(&mut cx);
    let chain_hint = cx.argument::<JsString>(3)?.value(&mut cx);
    
    let (config, _lightwalletd_uri) = match construct_uri_load_config(server_uri, chain_hint) {
        Ok(c) => c,
        Err(e) => return cx.throw_error(format!("{e}")),
    };
    
    let mnemonic = match Mnemonic::from_phrase(seed) {
        Ok(m) => m,
        Err(e) => {
            return cx.throw_error(format!("Error: {e}"));
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
        Err(e) => return cx.throw_error(format!("Error: {e}")),
    };
    let lightclient = match LightClient::create_from_wallet(wallet, config, false) {
        Ok(l) => l,
        Err(e) => {
            return cx.throw_error(format!("Error: {e}"));
        }
    };
    store_client(lightclient);

    Ok(cx.string("Lightclient initialized from seed phrase."))
}

/// Initialize a lightclient from a UFVK
fn init_from_ufvk(mut cx: FunctionContext) -> JsResult<JsString> {
    let server_uri = cx.argument::<JsString>(0)?.value(&mut cx);
    let ufvk = cx.argument::<JsString>(1)?.value(&mut cx);
    let birthday = cx.argument::<JsNumber>(2)?.value(&mut cx);
    let chain_hint = cx.argument::<JsString>(3)?.value(&mut cx);

    let (config, _lightwalletd_uri) = match construct_uri_load_config(server_uri, chain_hint) {
        Ok(c) => c,
        Err(e) => return cx.throw_error(format!("{e}")),
    };

    let wallet = match LightWallet::new(
        config.chain,
        WalletBase::Ufvk(ufvk),
        BlockHeight::from_u32(birthday as u32),
        config.wallet_settings.clone(),
    ) {
        Ok(w) => w,
        Err(e) => return cx.throw_error(format!("Error: {e}")),
    };

    let lightclient = match LightClient::create_from_wallet(wallet, config, false) {
        Ok(l) => l,
        Err(e) => {
            return cx.throw_error(format!("Error: {e}"));
        }
    };

    store_client(lightclient);
    
    Ok(cx.string("Lightclient initialized from UFVK."))
}

/// Initialize a lightclient from an existing wallet file 
fn init_from_disk(mut cx: FunctionContext) -> JsResult<JsString> {
    let server_uri = cx.argument::<JsString>(0)?.value(&mut cx);
    let chain_hint = cx.argument::<JsString>(1)?.value(&mut cx);
    
    let (config, _lightwalletd_uri) = match construct_uri_load_config(server_uri, chain_hint) {
        Ok(c) => c,
        Err(e) => return cx.throw_error(format!("Error: {}", e)),
    };

    println!("{:?}", config.clone().get_wallet_path());


    let lightclient = match LightClient::create_from_wallet_path(config) {
        Ok(w) => w,
        Err(e) => return cx.throw_error(format!("{}", e)),
    };


    store_client(lightclient);

    Ok(cx.string("Lightclient initialized from disk."))
}

fn save_wallet(mut cx: FunctionContext) -> JsResult<JsString> {
    // Get the wallet as a base64 encoded string
    // And save it to a wallet file
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {        
        RT.block_on(async move {
            match lightclient.wallet.write().await.save() {
                Ok(Some(wallet_bytes)) => {
                    let wallet_path = lightclient.config().get_wallet_path();

                    let mut file = match File::create(wallet_path) {
                        Ok(f) => f,
                        Err(e) => return cx.throw_error(format!("Error: {}", e.to_string())),
                    };
                    // Try to write wallet_bytes to file
                    match file.write_all(&wallet_bytes) {
                        Ok(()) => Ok(cx.string("Wallet file saved.")),
                        Err(e) => return cx.throw_error(format!("Error {}", e.to_string())),
                    }                  
                },
                // TODO: check this is better than a custom error when save is not required (empty buffer)
                Ok(None) => Ok(cx.string("No need to save the wallet file")),
                Err(e) => return cx.throw_error(format!("Error: {}", e)),
            }
        })
    } else {
        cx.throw_error("Error: Lightclient is not initialized")
    }
}

fn save_wallet_task(mut cx: FunctionContext) -> JsResult<JsString> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        RT.block_on(async move {
            let _task = lightclient.save_task().await;
            Ok(cx.string("Save task launched."))
        })                
    } else {
        return cx.throw_error("Error: Lightclient is not initialized")
    }
}

// TODO: deprecate
// pub fn execute_command(cmd: String, args_list: String) -> String {
//     if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
//         let args = if args_list.is_empty() {
//             vec![]
//         } else {
//             vec![args_list.as_ref()]
//         };
//         zingolib::commands::do_user_command(&cmd, &args, lightclient)
//     } else {
//         "Error: Lightclient is not initialized".to_string()
//     }
// }

fn get_latest_block_server(mut cx: FunctionContext) -> JsResult<JsString> {
    let server_uri = cx.argument::<JsString>(0)?.value(&mut cx);

    let lightwalletd_uri = match server_uri.parse() {
        Ok(uri) => uri,
        Err(e) => {
            return cx.throw_error(format!("Error: failed to parse uri. {e}"));
        }
    };
    let height = match RT
        .block_on(async move { zingolib::grpc_connector::get_latest_block(lightwalletd_uri).await })
    {
        Ok(block_id) => block_id.height.to_string(),
        Err(e) => return cx.throw_error(format!("Error: {e}")),
    };

    Ok(cx.string(height))
}

fn get_latest_block_wallet(mut cx: FunctionContext) -> JsResult<JsObject> {
    let obj = cx.empty_object();
    if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
        RT.block_on(async move {
            let height = cx.number(lightclient.wallet.write().await.sync_state.fully_scanned_height().map(u32::from).unwrap_or(0));
            obj.set(&mut cx, "height", height).expect("Error fetching wallet height.");            
        });
        Ok(obj)
    } else {
        return cx.throw_error("Error: Lightclient is not initialized");
    }
}

fn get_notes(mut cx: FunctionContext) -> JsResult<JsString> {
    let all_notes = if cx.argument::<JsBoolean>(0)?.value(&mut cx) {
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

        Ok(cx.string(notes))
    }
    else {
        return cx.throw_error("Error: Lightclient is not initialized");
    }
}

fn get_balance(mut cx: FunctionContext) -> JsResult<JsObject> {        
    if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
        let obj = RT.block_on(async move {
            let balance = lightclient.account_balance(AccountId::ZERO).await.expect("Error getting AccountBalance");
            let neon_balance = NeonAccountBalance::new(balance).expect("Error creating NeonAccountBalance");
            
            neon_balance.to_object(&mut cx).expect("Error converting NeonAccountBalance to JsObject")
        });
        
        Ok(obj)    
    } else {
        return cx.throw_error("Error: Lightclient is not initialized".to_string())
    }
}

fn get_spendable_balance_total(mut cx: FunctionContext) -> JsResult<JsObject> {
    let obj = cx.empty_object();
    
    if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
        RT.block_on(async move {
            let wallet = lightclient.wallet.write().await;
            let spendable_balance = match wallet.shielded_spendable_balance(AccountId::ZERO, false) {
                Ok(bal) => cx.number(bal.into_u64() as f64),
                Err(e) => return cx.throw_error(format!("Error {}", e)),
            };
            obj.set(&mut cx, "spendable_balance", spendable_balance).expect("Error setting spensable_balance");
            Ok(obj)
        })      
    } else {
        return cx.throw_error("Error: Lightclient is not initialized")
    }
}

fn get_unified_addresses(mut cx: FunctionContext) -> JsResult<JsString> {
    if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
        RT.block_on(async move { Ok(cx.string(lightclient.unified_addresses_json().await.pretty(2))) })
    } else {
        return cx.throw_error("Error: Lightclient is not initialized")
    }
}

fn create_new_unified_address(mut cx: FunctionContext) -> JsResult<JsString> {
    let receivers = cx.argument::<JsString>(0)?.value(&mut cx);
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        RT.block_on(async move {
            let mut wallet = lightclient.wallet.write().await;
            let network = wallet.network;
            let receivers_available = ReceiverSelection {
                orchard: receivers.contains('o'),
                sapling: receivers.contains('z'),
            };
            let ua = match wallet.generate_unified_address(receivers_available, AccountId::ZERO) {
                Ok((id, unified_address)) => {
                    json::object! {
                        "account" => u32::from(AccountId::ZERO),
                        "address_index" => id.address_index,
                        "has_orchard" => unified_address.has_orchard(),
                        "has_sapling" => unified_address.has_sapling(),
                        "has_transparent" => unified_address.has_transparent(),
                        "encoded_address" => unified_address.encode(&network),
                    }.pretty(2)
                }
                Err(e) => return cx.throw_error(format!("Error: {e}")),
            };
            Ok(cx.string(ua))
        })
    } else {
        return cx.throw_error("Error: Lightclient is not initialized")
    }
}

fn parse_address(mut cx: FunctionContext) -> JsResult<JsString> {
    let address = cx.argument::<JsString>(0)?.value(&mut cx);
    
    if address.is_empty() {
        return cx.throw_error("Error: The address is empty")
    } else {
        fn make_decoded_chain_pair(
            address: &str,
        ) -> Option<(zcash_client_backend::address::Address, ChainType)> {
            [
                ChainType::Mainnet,
                ChainType::Testnet,
                ChainType::Regtest(ActivationHeights::default()),
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
            Ok(cx.string(parsed))
        } else {
            Ok(cx.string(json::object! {
                "status" => "Invalid address",
                "chain_name" => json::JsonValue::Null,
                "address_kind" => json::JsonValue::Null,
            }
            .pretty(2)))
        }
    }
}

fn run_rescan(mut cx: FunctionContext) -> JsResult<JsString> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        RT.block_on(async move {
            match lightclient.rescan().await {
                Ok(_) => Ok(cx.string("Launching rescan...")),
                Err(e) => return cx.throw_error(format!("Error: {e}")),
            }
        })
    } else {
        return cx.throw_error("Error: Lightclient is not initialized")
    }
}

fn run_sync(mut cx: FunctionContext) -> JsResult<JsString> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        if lightclient.sync_mode() == SyncMode::Paused {
            lightclient.resume_sync().expect("sync should be paused");
            Ok(cx.string("Resuming sync task..."))
        } else {
            RT.block_on(async move {
                let resp = match lightclient.sync().await {
                    Ok(_) => "Launching sync task...".to_string(),
                    Err(e) => format!("Error: {e}"),
                };
                Ok(cx.string(resp))
            })
        }
    } else {
        return cx.throw_error("Error: Lightclient is not initialized")
    }
}

fn pause_sync(mut cx: FunctionContext) -> JsResult<JsString> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        match lightclient.pause_sync() {
            Ok(_) => Ok(cx.string("Pausing sync task...")),
            Err(e) => cx.throw_error(format!("Error: {e}")),
        }        
    } else {
        return cx.throw_error("Error: Lightclient is not initialized")
    }
}

fn stop_sync(mut cx: FunctionContext) -> JsResult<JsString> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        match lightclient.stop_sync() {
            Ok(_) => Ok(cx.string("Stopping sync task...")),
            Err(e) => return cx.throw_error(format!("Error: {e}")),
        }
    } else {
        return cx.throw_error("Error: Lightclient is not initialized")
    }
}

fn status_sync(mut cx: FunctionContext) -> JsResult<JsString> {
    if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
        RT.block_on(async move {
            let status_sync = match pepper_sync::sync_status(&*lightclient.wallet.read().await).await {
                Ok(status) => json::JsonValue::from(status).pretty(2),
                Err(e) => format!("Error: {e}"),
            };
            Ok(cx.string(status_sync))
        })
    } else {
        return cx.throw_error("Error: Lightclient is not initialized")
    }
}

fn poll_sync(mut cx: FunctionContext) -> JsResult<JsString> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        let poll_sync = match lightclient.poll_sync() {
            PollReport::NoHandle => "Sync task has not been launched.".to_string(),
            PollReport::NotReady => "Sync task is not complete.".to_string(),
            PollReport::Ready(result) => match result {
                Ok(sync_result) => {
                    json::object! { "sync_complete" => json::JsonValue::from(sync_result) }
                        .pretty(2)
                }
                Err(e) => format!("Error: {e}"),
            },
        };
        Ok(cx.string(poll_sync))
    } else {
        return cx.throw_error("Error: Lightclient is not initialized")
    }
}
fn get_value_transfers(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let promise = cx.task(move || {
        if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
            RT.block_on(async move {
                let vt = match lightclient
                    .wallet
                    .read()
                    .await
                    .value_transfers(true)
                    .await
                {
                    Ok(value_transfers) => json::JsonValue::from(value_transfers).pretty(2),
                    Err(e) => format!("Error: {e}"),
                };
                Ok(vt)
            })
        } else {
            Err("Error: Lightclient is not initialized")
        }
    }).promise(|mut cx, vt| {
        match vt {
            Ok(vts) => Ok(cx.string(vts)),
            Err(e) => return cx.throw_error(e)
        }
    });

    Ok(promise)
}

// fn get_value_transfers_blocking(mut cx: FunctionContext) -> JsResult<JsString> {
//     if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
//         RT.block_on(async move {
//             let vt = match lightclient
//                 .wallet
//                 .read()
//                 .await
//                 .value_transfers(true)
//                 .await
//             {
//                 Ok(value_transfers) => json::JsonValue::from(value_transfers).pretty(2),
//                 Err(e) => format!("Error: {e}"),
//             };
//             Ok(cx.string(vt))
//         })
//     } else {
//         return cx.throw_error("Error: Lightclient is not initialized")
//     }
// }

fn get_seed(mut cx: FunctionContext) -> JsResult<JsString> {
    if let Some(lightclient) = &*LIGHTCLIENT.read().unwrap() {
        RT.block_on(async move {
            let seed = match lightclient.wallet.read().await.recovery_info() {
                Some(recovery_info) => serde_json::to_string_pretty(&recovery_info)
                    .unwrap_or_else(|_| "error: get seed. failed to serialize".to_string()),
                None => "error: get seed. no mnemonic found. wallet loaded from key.".to_string(),
            };
            Ok(cx.string(seed))
        })
    } else {
        return cx.throw_error("Error: Lightclient is not initialized")
    }
}

fn get_ufvk(mut cx: FunctionContext) -> JsResult<JsString> {
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
                    return cx.throw_error(format!("Error: {e}"));
                }
            };
            Ok(cx.string(json::object! {
                "ufvk" => ufvk.encode(&wallet.network),
                "birthday" => u32::from(wallet.birthday)
            }
            .pretty(2)))
        })
    } else {
        return cx.throw_error("Error: Lightclient is not initialized")
    }
}

fn send(mut cx: FunctionContext) -> JsResult<JsPromise> {
    let send_json = cx.argument::<JsString>(0)?.value(&mut cx);
    
    let json_args = match json::parse(&send_json) {
        Ok(parsed) => parsed,
        Err(_) => return cx.throw_error("Error: it is not a valid JSON")
    };

    let promise = cx.task(move || {
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
    }).promise(|mut cx, resp| {
        match resp {
            Ok(txids) => Ok(cx.string(txids)),
            Err(e) => return cx.throw_error(format!("{e}")),
        }
    });

    Ok(promise)
}

fn confirm(mut cx: FunctionContext) -> JsResult<JsString> {
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        RT.block_on(async move {
            match lightclient
                .send_stored_proposal()
                .await 
            {
                Ok(txids) => {
                    Ok(cx.string(json::object! { "txids" => txids.iter().map(|txid| txid.to_string()).collect::<Vec<_>>() }.pretty(2)))
                }
                Err(e) => {
                    cx.throw_error(json::object! { "error" => e.to_string() }.pretty(2))
                }
            }
        })        
    } else {
        return cx.throw_error("Error: Lightclient is not initialized")
    }
}

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

fn quick_shield(mut cx: FunctionContext) -> JsResult<JsString>{
    if let Some(lightclient) = &mut *LIGHTCLIENT.write().unwrap() {
        RT.block_on(async move {
            match lightclient
                .quick_shield(AccountId::ZERO)
                .await {
                    Ok(txids) => Ok(cx.string(json::object! { "txids" => txids.iter().map(|txid| txid.to_string()).collect::<Vec<_>>() }.pretty(2))),
                    Err(e) => return cx.throw_error(format!("{}", json::object! { "error" => e.to_string() })),
                }
        })        
    } else {
        return cx.throw_error("Error: Lightclient is not initialized")
    }
}

fn set_crypto_default_provider_to_ring(mut cx: FunctionContext) -> JsResult<JsString> {
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

    Ok(cx.string(resp))
}

// fn decode_ua(mut cx: FunctionContext) -> JsResult<JsObject> {
//     // Retrieve the Unified Address from the first argument
//     let ua = cx.argument::<JsString>(0)?.value(&mut cx);

//     // Attempt to decode the Unified Address
//     let ua_full = match UnifiedAddress::decode(&MainNetwork, &ua) {
//         Ok(u) => u,
//         Err(err) => return cx.throw_error(format!("Failed to decode Unified Address: {}", err)),
//     };

//     // Extract Sapling address, if it exists
//     let sapling_str: Option<String> = ua_full
//         .sapling()
//         .map(|addr| encode_payment_address(HRP_SAPLING_PAYMENT_ADDRESS, &addr));

//     // Create Neon strings for the output
//     let ua_neon = cx.string(&ua);
//     let sapling_neon = cx.string(sapling_str.unwrap_or_else(|| "null".to_string()));

//     // Construct the result object
//     let obj = cx.empty_object();
//     obj.set(&mut cx, "ua", ua_neon)?;
//     obj.set(&mut cx, "sapling", sapling_neon)?;

//     Ok(obj)
// }