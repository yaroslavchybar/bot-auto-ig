mod variant_engine;

fn main() {
    if let Err(error) = variant_engine::run_cli(&std::env::args().skip(1).collect::<Vec<_>>()) {
        if std::env::args().any(|arg| arg == "--json") {
            eprintln!("{}", serde_json::json!({ "ok": false, "error": error }));
        } else {
            eprintln!("{error}");
        }
        std::process::exit(1);
    }
}
