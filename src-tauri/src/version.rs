//! Shared dotted-version comparison for app and platform package updates.

pub fn parse_version(value: &str) -> [u64; 4] {
    let mut parts = value
        .trim()
        .trim_start_matches(['v', 'V'])
        .split(|byte: char| !byte.is_ascii_digit());
    let mut out = [0; 4];
    for slot in &mut out {
        *slot = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    }
    out
}

pub fn version_is_newer(current: &str, candidate: &str) -> bool {
    parse_version(candidate) > parse_version(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn treats_higher_semver_as_newer() {
        assert!(version_is_newer("0.11.8", "0.11.9"));
        assert!(!version_is_newer("0.11.9", "0.11.9"));
        assert!(!version_is_newer("3.6.2", "3.6.1"));
        assert!(version_is_newer("3.6.2", "3.6.2.1"));
    }
}
