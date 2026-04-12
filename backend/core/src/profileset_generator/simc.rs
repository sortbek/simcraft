use regex::Regex;

const BASE64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub(super) fn extract_spec_id_from_talent_string(talent_str: &str) -> Option<u64> {
    let mut bits = Vec::new();
    for ch in talent_str.bytes() {
        let val = BASE64.iter().position(|&b| b == ch)?;
        for bit in 0..6 {
            bits.push((val >> bit) & 1);
        }
        if bits.len() >= 24 {
            break;
        }
    }
    if bits.len() < 24 {
        return None;
    }
    let mut spec_id = 0u64;
    for i in 0..16 {
        if bits[8 + i] == 1 {
            spec_id |= 1 << i;
        }
    }
    Some(spec_id)
}

pub(super) fn set_enchant_id(simc: &str, enchant_id: u64) -> String {
    let re = Regex::new(r"enchant_id=\d+").unwrap();
    if re.is_match(simc) {
        re.replace(simc, &format!("enchant_id={}", enchant_id))
            .to_string()
    } else {
        let id_re = Regex::new(r"(,id=\d+)").unwrap();
        id_re
            .replace(simc, &format!("$1,enchant_id={}", enchant_id))
            .to_string()
    }
}

pub(super) fn set_gem_id(simc: &str, gem_id: u64) -> String {
    let re = Regex::new(r"gem_id=\d+").unwrap();
    if re.is_match(simc) {
        re.replace(simc, &format!("gem_id={}", gem_id)).to_string()
    } else {
        let id_re = Regex::new(r"(,id=\d+)").unwrap();
        id_re
            .replace(simc, &format!("$1,gem_id={}", gem_id))
            .to_string()
    }
}

pub(super) fn extract_enchant_id(simc: &str) -> u64 {
    let re = Regex::new(r"enchant_id=(\d+)").unwrap();
    re.captures(simc)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(0)
}

pub(super) fn combinations<T: Clone>(items: &[T], k: usize) -> Vec<Vec<T>> {
    if k == 0 {
        return vec![vec![]];
    }
    if items.len() < k {
        return vec![];
    }
    let mut result = Vec::new();
    for (i, item) in items.iter().enumerate() {
        let rest = combinations(&items[i + 1..], k - 1);
        for mut sub in rest {
            sub.insert(0, item.clone());
            result.push(sub);
        }
    }
    result
}

pub(super) fn simc_has_socket(simc: &str) -> bool {
    if extract_gem_id(simc) > 0 {
        return true;
    }
    let bonus_re = Regex::new(r"bonus_id=([0-9/:]+)").unwrap();
    let bonus_ids: Vec<u64> = bonus_re
        .captures(simc)
        .map(|c| {
            c[1].split(&['/', ':'][..])
                .filter_map(|s| s.parse().ok())
                .collect()
        })
        .unwrap_or_default();
    let resolved = crate::item_db::resolve_bonuses(&bonus_ids);
    resolved.sockets.unwrap_or(0) > 0
}

pub(super) fn is_diamond(gem_item_id: u64) -> bool {
    crate::item_db::enchants_by_item_id()
        .get(&gem_item_id)
        .and_then(|v| v.get("quality"))
        .and_then(|q| q.as_u64())
        .map(|q| q == 4)
        .unwrap_or(false)
}

pub(super) fn gem_color(gem_item_id: u64) -> Option<String> {
    crate::item_db::enchants_by_item_id()
        .get(&gem_item_id)
        .and_then(|v| v.get("algariColor"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
}

pub(super) fn extract_item_id(simc: &str) -> u64 {
    let re = Regex::new(r"id=(\d+)").unwrap();
    re.captures(simc)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(0)
}

pub(super) fn extract_gem_id(simc: &str) -> u64 {
    let re = Regex::new(r"gem_id=(\d+)").unwrap();
    re.captures(simc)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(0)
}
