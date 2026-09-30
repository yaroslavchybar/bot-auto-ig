use axum::{extract::Request, response::Response, Router};
use std::future::Future;
pub struct Fixture {
    pub url: String,
    task: tokio::task::JoinHandle<()>,
}
impl Fixture {
    pub async fn start<F, Fut>(handler: F) -> Self
    where
        F: Fn(Request) -> Fut + Clone + Send + Sync + 'static,
        Fut: Future<Output = Response> + Send + 'static,
    {
        Self::router(Router::new().fallback(handler)).await
    }
    pub async fn router(router: Router) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(
                listener,
                router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await
            .unwrap();
        });
        Self { url, task }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
pub async fn body(request: Request) -> serde_json::Value {
    let bytes = axum::body::to_bytes(request.into_body(), 15 * 1024 * 1024)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap_or_default()
}
