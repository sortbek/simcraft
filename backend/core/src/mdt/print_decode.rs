//! LibDeflate `DecodeForPrint` — the printable encoding MDT uses for copy/paste
//! export strings.
//!
//! Alphabet (value 0..63 -> char), from LibDeflate's `_byte_to_6bit_char`:
//!   a-z (0..25), A-Z (26..51), 0-9 (52..61), '(' (62), ')' (63)
//!
//! Bytes are packed little-endian, 6 bits per character (3 bytes <-> 4 chars).
//! Decoding accumulates 6 bits per char LSB-first and emits a byte whenever 8
//! bits are available; any trailing bits < 8 are discarded.

/// Map a printable character to its 6-bit value, or `None` if it is not part of
/// the alphabet.
fn char_to_6bit(c: u8) -> Option<u8> {
    match c {
        b'a'..=b'z' => Some(c - b'a'),
        b'A'..=b'Z' => Some(c - b'A' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'(' => Some(62),
        b')' => Some(63),
        _ => None,
    }
}

/// Decode a `DecodeForPrint` string into raw bytes. Whitespace and other
/// characters outside the alphabet are skipped, mirroring LibDeflate which
/// strips control/whitespace before decoding.
pub fn decode_for_print(input: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len() * 3 / 4 + 1);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for &c in input.as_bytes() {
        let Some(v) = char_to_6bit(c) else { continue };
        acc |= (v as u32) << bits;
        bits += 6;
        while bits >= 8 {
            out.push((acc & 0xFF) as u8);
            acc >>= 8;
            bits -= 8;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_known_alphabet() {
        // 'a' = 0, 'b' = 1 -> two 6-bit groups 000000 000001 = 12 bits.
        // LSB-first: acc = 0 | (1<<6) = 64, bits 12 -> emit byte 64, 4 bits left.
        assert_eq!(decode_for_print("ab"), vec![64]);
    }

    #[test]
    fn skips_unknown_chars() {
        assert_eq!(decode_for_print("a b"), decode_for_print("ab"));
    }
}
