mod service;
mod variant_engine;

fn main() {
    if std::env::args().nth(1).as_deref() == Some("serve") {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        if runtime.block_on(service::serve()).is_err() {
            ig_service_common::service_error("spoofer.failed", "Spoofer service stopped");
            std::process::exit(1);
        }
        return;
    }
    if let Err(error) = variant_engine::run_cli(&std::env::args().skip(1).collect::<Vec<_>>()) {
        if std::env::args().any(|arg| arg == "--json") {
            eprintln!("{}", serde_json::json!({ "ok": false, "error": error }));
        } else {
            eprintln!("{error}");
        }
        std::process::exit(1);
    }
}
