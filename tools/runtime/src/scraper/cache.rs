use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

/// Only acknowledged list memberships are cached, so partial quota pauses can resume.
pub struct Cache {
    db: Connection,
}
impl Cache {
    pub fn open(file: &Path) -> crate::native::Result<Self> {
        if file != Path::new(":memory:") {
            if let Some(dir) = file.parent() {
                std::fs::create_dir_all(dir)?;
            }
        }
        let db = Connection::open(file)?;
        #[cfg(unix)]
        if file != Path::new(":memory:") {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o600))?;
        }
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS seen (listId TEXT NOT NULL, igId TEXT NOT NULL, at INTEGER NOT NULL,
              PRIMARY KEY(listId, igId));
            CREATE TABLE IF NOT EXISTS post_seen (mediaId TEXT NOT NULL, igId TEXT NOT NULL,
              PRIMARY KEY(mediaId, igId));
            CREATE TABLE IF NOT EXISTS observations (mediaId TEXT PRIMARY KEY, runId TEXT NOT NULL, newIds INTEGER NOT NULL);")?;
        db.execute(
            "DELETE FROM seen WHERE at < ?",
            [crate::api::now_ms().saturating_sub(90 * 86_400_000) as i64],
        )?;
        Ok(Self { db })
    }
    pub fn contains(&self, list: &str, id: &str) -> crate::native::Result<bool> {
        Ok(self
            .db
            .query_row(
                "SELECT 1 FROM seen WHERE listId=? AND igId=?",
                params![list, id],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false))
    }
    pub fn acknowledge(&mut self, list: &str, ids: &[String]) -> crate::native::Result<()> {
        let tx = self.db.transaction()?;
        for id in ids {
            tx.execute("INSERT INTO seen VALUES (?, ?, ?) ON CONFLICT(listId, igId) DO UPDATE SET at=excluded.at", params![list, id, crate::api::now_ms() as i64])?;
        }
        tx.commit()?;
        Ok(())
    }
    /// Post traffic is independent of list membership and includes private liker IDs.
    pub fn observe(
        &mut self,
        media: &str,
        run: &str,
        ids: &[String],
    ) -> crate::native::Result<u64> {
        let tx = self.db.transaction()?;
        if let Some(count) = tx
            .query_row(
                "SELECT newIds FROM observations WHERE mediaId=? AND runId=?",
                params![media, run],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
        {
            return Ok(count as u64);
        }
        let mut count = 0;
        for id in ids {
            count += tx.execute(
                "INSERT OR IGNORE INTO post_seen VALUES (?, ?)",
                params![media, id],
            )? as u64;
        }
        tx.execute("INSERT INTO observations VALUES (?, ?, ?) ON CONFLICT(mediaId) DO UPDATE SET runId=excluded.runId, newIds=excluded.newIds",
            params![media, run, count as i64])?;
        tx.commit()?;
        Ok(count)
    }
}
