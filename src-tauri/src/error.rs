//! User-safe application errors shared by all Tauri commands.
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }
    pub fn detail(mut self, detail: impl Into<String>) -> Self {
        self.details = Some(detail.into());
        self
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(_: rusqlite::Error) -> Self {
        Self::new("DATABASE_ERROR", "本地数据库操作失败")
    }
}
impl From<std::io::Error> for AppError {
    fn from(_: std::io::Error) -> Self {
        Self::new("IO_ERROR", "本地文件操作失败")
    }
}
