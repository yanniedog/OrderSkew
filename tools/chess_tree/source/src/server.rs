use crate::api::{Neighbors, TreeApi, TreeStats};
use crate::metrics::MetricsSnapshot;
use crate::db::DbPool;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Html, Json},
    routing::get,
    Router,
};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Instant;
use tower_http::{cors::CorsLayer, services::ServeDir};

pub async fn start_server(db_path: String, port: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Initialize database
    let db = Arc::new(DbPool::new(&db_path)?);
    db.init_schema()?;
    let api = Arc::new(TreeApi::new(db.clone()));

    let app = Router::new()
        .route("/", get(index_handler))
        .route("/api/position/:hash", get(get_position))
        .route("/api/position", get(get_root_position))
        .route("/api/stats", get(get_stats))
        .route("/api/metrics", get(get_metrics))
        .route("/api/search", get(search_positions))
        .route("/api/neighbors/:hash", get(get_neighbors))
        .nest_service("/static", ServeDir::new("static"))
        .layer(CorsLayer::permissive())
        .with_state(api);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port)).await?;
    println!("Tree visualization server running on http://localhost:{}", port);
    println!("Open http://localhost:{} in your browser to view the tree", port);

    axum::serve(listener, app).await?;
    Ok(())
}

async fn index_handler() -> Html<&'static str> {
    Html(include_str!("../static/index.html"))
}

async fn get_position(
    Path(hash): Path<u64>,
    State(api): State<Arc<TreeApi>>,
) -> Result<Json<crate::api::PositionNode>, StatusCode> {
    match api.get_position(Some(hash)) {
        Ok(node) => {
            println!(
                "[API] Served position {} with {} children",
                node.hash,
                node.children.len()
            );
            Ok(Json(node))
        }
        Err(err) => {
            eprintln!(
                "[API] Failed to load position {}: {:?}",
                hash, err
            );
            Err(StatusCode::NOT_FOUND)
        }
    }
}

async fn get_root_position(
    State(api): State<Arc<TreeApi>>,
) -> Result<Json<crate::api::PositionNode>, StatusCode> {
    match api.get_position(None) {
        Ok(node) => {
            println!(
                "[API] Served root position {} with {} children",
                node.hash,
                node.children.len()
            );
            Ok(Json(node))
        }
        Err(err) => {
            eprintln!("[API] Failed to load root position: {:?}", err);
            Err(StatusCode::NOT_FOUND)
        }
    }
}

async fn get_stats(
    State(api): State<Arc<TreeApi>>,
) -> Result<Json<TreeStats>, StatusCode> {
    match api.get_stats() {
        Ok(stats) => {
            println!(
                "[API] Served stats: positions={}, edges={}, max_depth={}",
                stats.total_positions, stats.total_edges, stats.max_depth
            );
            Ok(Json(stats))
        }
        Err(err) => {
            eprintln!("[API] Failed to load stats: {:?}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_metrics(
    State(api): State<Arc<TreeApi>>,
) -> Json<MetricsSnapshot> {
    Json(api.metrics_snapshot())
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
}

#[derive(Deserialize)]
struct NeighborsQuery {
    parent_limit: Option<u32>,
}

async fn search_positions(
    Query(params): Query<SearchQuery>,
    State(api): State<Arc<TreeApi>>,
) -> Result<Json<Vec<u64>>, StatusCode> {
    // Simple search by FEN substring or move sequence
    let timer = Instant::now();
    let conn = api
        .db()
        .connection()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    let query = format!("%{}%", params.q);
    let mut stmt = conn
        .prepare("SELECT hash FROM positions WHERE fen LIKE ?1 OR move_sequence LIKE ?1 LIMIT 50")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    let hashes: Result<Vec<u64>, _> = stmt
        .query_map([query], |row| Ok(row.get::<_, i64>(0)? as u64))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect();
    
    match hashes {
        Ok(h) => {
            println!(
                "[API] Search '{}' returned {} hashes",
                params.q,
                h.len()
            );
            api.metrics()
                .record_database_operation(timer.elapsed().as_millis() as u64);
            Ok(Json(h))
        }
        Err(err) => {
            eprintln!(
                "[API] Search '{}' failed: {:?}",
                params.q, err
            );
            api.metrics()
                .record_database_operation(timer.elapsed().as_millis() as u64);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn get_neighbors(
    Path(hash): Path<u64>,
    Query(query): Query<NeighborsQuery>,
    State(api): State<Arc<TreeApi>>,
) -> Result<Json<Neighbors>, StatusCode> {
    match api.get_neighbors(hash, query.parent_limit) {
        Ok(neighbors) => Ok(Json(neighbors)),
        Err(err) => {
            eprintln!(
                "[API] Failed to load neighbors for {}: {:?}",
                hash, err
            );
            Err(StatusCode::NOT_FOUND)
        }
    }
}
