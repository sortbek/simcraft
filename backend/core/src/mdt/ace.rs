//! Minimal port of AceSerializer-3.0 deserialization (the format MDT uses
//! *after* DEFLATE decompression — not LibSerialize).
//!
//! Wire format: a flat stream of `^<ctl><payload>` tokens, framed by `^1`
//! (version) at the start and `^^` at the end. `^` never appears inside a
//! payload (it is escaped to `~}` in strings), so the stream tokenizes by
//! splitting on `^`.
//!
//! Control codes:
//!   ^1  stream/version marker (first token)
//!   ^^  end of stream
//!   ^S  string (payload is escaped, see `unescape`)
//!   ^N  number (payload is the decimal/exponential text)
//!   ^F  float mantissa; immediately followed by ^f exponent -> mantissa*2^exp
//!   ^T  table begin (flat key,value,key,value,... until ^t)
//!   ^t  table end
//!   ^B  boolean true
//!   ^b  boolean false
//!   ^Z  nil

#[derive(Debug, Clone, PartialEq)]
pub enum AceValue {
    Nil,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    Table(AceTable),
}

/// A Lua table preserved as ordered key/value pairs. Lua does not distinguish
/// arrays from maps, so callers pick out integer keys (sequence) or string keys
/// (named fields) as needed.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct AceTable {
    pub pairs: Vec<(AceValue, AceValue)>,
}

impl AceTable {
    /// Value for a string key, if present.
    pub fn get_str(&self, key: &str) -> Option<&AceValue> {
        self.pairs.iter().find_map(|(k, v)| match k {
            AceValue::Str(s) if s == key => Some(v),
            _ => None,
        })
    }

    /// Integer-keyed entries, sorted ascending by key. Used to read sequence
    /// tables (`pulls`, clone-index lists) and the enemy entries within a pull.
    ///
    /// AceSerializer stores whole numbers via the float path, so integral
    /// `Float` keys count as integer keys too.
    pub fn int_entries(&self) -> Vec<(i64, &AceValue)> {
        let mut out: Vec<(i64, &AceValue)> = self
            .pairs
            .iter()
            .filter_map(|(k, v)| match k {
                AceValue::Int(i) => Some((*i, v)),
                AceValue::Float(f) if f.fract() == 0.0 => Some((*f as i64, v)),
                _ => None,
            })
            .collect();
        out.sort_by_key(|(i, _)| *i);
        out
    }

    /// Integer-keyed entries in original (serialized) order. Used where MDT's
    /// `pairs()` order is significant — the SimC export lists a pull's enemies in
    /// this order, not sorted.
    pub fn int_entries_ordered(&self) -> Vec<(i64, &AceValue)> {
        self.pairs
            .iter()
            .filter_map(|(k, v)| match k {
                AceValue::Int(i) => Some((*i, v)),
                AceValue::Float(f) if f.fract() == 0.0 => Some((*f as i64, v)),
                _ => None,
            })
            .collect()
    }
}

impl AceValue {
    pub fn as_int(&self) -> Option<i64> {
        match self {
            AceValue::Int(i) => Some(*i),
            AceValue::Float(f) => Some(*f as i64),
            _ => None,
        }
    }
    pub fn as_table(&self) -> Option<&AceTable> {
        match self {
            AceValue::Table(t) => Some(t),
            _ => None,
        }
    }
}

/// Deserialize an AceSerializer-3.0 stream into a single top-level value.
pub fn deserialize(input: &str) -> Result<AceValue, String> {
    let tokens = tokenize(input)?;
    if tokens.first().map(|(c, _)| *c) != Some(b'1') {
        return Err("not an AceSerializer stream (missing ^1 header)".into());
    }
    let mut pos = 1; // skip the ^1 version token
    let value = read_value(&tokens, &mut pos)?;
    Ok(value)
}

/// Split the stream into `(control_char, payload)` tokens. The payload is the
/// raw text between this `^X` and the next `^`.
fn tokenize(input: &str) -> Result<Vec<(u8, &str)>, String> {
    let bytes = input.as_bytes();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'^' {
            return Err(format!("expected '^' at byte {i}"));
        }
        if i + 1 >= bytes.len() {
            return Err("truncated control token".into());
        }
        let ctl = bytes[i + 1];
        let start = i + 2;
        let mut j = start;
        while j < bytes.len() && bytes[j] != b'^' {
            j += 1;
        }
        tokens.push((ctl, &input[start..j]));
        i = j;
    }
    Ok(tokens)
}

fn read_value(tokens: &[(u8, &str)], pos: &mut usize) -> Result<AceValue, String> {
    let (ctl, payload) = *tokens
        .get(*pos)
        .ok_or_else(|| "unexpected end of token stream".to_string())?;
    *pos += 1;
    match ctl {
        b'S' => Ok(AceValue::Str(unescape(payload))),
        b'N' => parse_number(payload),
        b'F' => {
            let mantissa: f64 = payload
                .parse()
                .map_err(|_| format!("bad float mantissa '{payload}'"))?;
            let (ctl2, exp_payload) = *tokens
                .get(*pos)
                .ok_or_else(|| "float mantissa without exponent".to_string())?;
            *pos += 1;
            if ctl2 != b'f' {
                return Err("expected ^f exponent after ^F mantissa".into());
            }
            let exp: i32 = exp_payload
                .parse()
                .map_err(|_| format!("bad float exponent '{exp_payload}'"))?;
            Ok(AceValue::Float(mantissa * 2f64.powi(exp)))
        }
        b'T' => {
            let mut table = AceTable::default();
            loop {
                let (next_ctl, _) = *tokens
                    .get(*pos)
                    .ok_or_else(|| "unterminated table".to_string())?;
                if next_ctl == b't' {
                    *pos += 1;
                    break;
                }
                let key = read_value(tokens, pos)?;
                let val = read_value(tokens, pos)?;
                table.pairs.push((key, val));
            }
            Ok(AceValue::Table(table))
        }
        b'B' => Ok(AceValue::Bool(true)),
        b'b' => Ok(AceValue::Bool(false)),
        b'Z' => Ok(AceValue::Nil),
        other => Err(format!("unsupported AceSerializer control '^{}'", other as char)),
    }
}

fn parse_number(payload: &str) -> Result<AceValue, String> {
    if let Ok(i) = payload.parse::<i64>() {
        return Ok(AceValue::Int(i));
    }
    payload
        .parse::<f64>()
        .map(AceValue::Float)
        .map_err(|_| format!("bad number '{payload}'"))
}

/// Reverse AceSerializer's string escaping. Escapes are `~<c>`:
///   ~z       -> byte 30
///   ~}       -> '^' (94)
///   ~|       -> '~' (126)
///   ~<other> -> byte (other - 64)   (covers control bytes 0..32)
fn unescape(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'~' && i + 1 < bytes.len() {
            let c2 = bytes[i + 1];
            let decoded = match c2 {
                b'z' => 30,
                b'}' => 94,
                b'|' => 126,
                _ => c2.wrapping_sub(64),
            };
            out.push(decoded);
            i += 2;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_flat_table() {
        // { ["a"] = 1, ["b"] = true }
        let v = deserialize("^1^T^Sa^N1^Sb^B^t^^").unwrap();
        let t = v.as_table().unwrap();
        assert_eq!(t.get_str("a").unwrap().as_int(), Some(1));
        assert_eq!(t.get_str("b"), Some(&AceValue::Bool(true)));
    }

    #[test]
    fn parses_nested_and_sequence() {
        // { ["value"] = { [1] = 10, [2] = 20 } }
        let v = deserialize("^1^T^Svalue^T^N1^N10^N2^N20^t^t^^").unwrap();
        let inner = v.as_table().unwrap().get_str("value").unwrap().as_table().unwrap();
        let seq: Vec<i64> = inner.int_entries().iter().map(|(_, val)| val.as_int().unwrap()).collect();
        assert_eq!(seq, vec![10, 20]);
    }

    #[test]
    fn unescapes_caret() {
        // "a^b" serializes the '^' as ~}
        assert_eq!(unescape("a~}b"), "a^b");
    }

    #[test]
    fn int_entries_ordered_preserves_insertion_order() {
        // { [5]=.., [1]=.., [3]=.. } must stay 5,1,3 — not sorted to 1,3,5.
        let v = deserialize("^1^T^N5^Sa^N1^Sb^N3^Sc^t^^").unwrap();
        let t = v.as_table().unwrap();
        let keys: Vec<i64> = t.int_entries_ordered().iter().map(|(k, _)| *k).collect();
        assert_eq!(keys, vec![5, 1, 3]);
    }
}
