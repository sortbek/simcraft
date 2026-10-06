pub mod client;
pub mod payload;
pub mod service;

/// simhammer.com share ids: 10 ASCII letters and digits.
pub fn is_share_id(s: &str) -> bool {
    s.len() == 10 && s.bytes().all(|b| b.is_ascii_alphanumeric())
}
